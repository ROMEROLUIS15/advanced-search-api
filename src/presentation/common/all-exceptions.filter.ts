import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { errors as esErrors } from '@elastic/elasticsearch';
import {
  ApplicationError,
  ResultWindowExceededError,
  UpstreamResponseError,
} from '@application/errors/application.error';
import { DomainError } from '@domain/errors/domain.error';
import type { AppConfiguration } from '@config/app-config';
import {
  API_KEY_HEADER,
  type KeyIdentifier,
  createKeyIdentifier,
} from '@presentation/auth/api-key.identity';
import { pathWithoutQuery } from '@shared/operator-paths';
import { ALLOW_HEADER_VALUE, isAllowedMethod, isApiPath } from './api-routes';

interface ResolvedError {
  statusCode: number;
  error: string;
  message: string | string[];
  details?: string[];
}

interface ErrorBody extends ResolvedError {
  timestamp: string;
  path: string;
}

/**
 * Global exception filter (design D10). Maps typed errors, Nest HTTP exceptions
 * and Elasticsearch upstream failures into a consistent body. 5xx are logged as
 * errors with their stack (the client still gets a generic message); 4xx are
 * logged as warnings with a compact reason so client-side failures and
 * rate-limit hits stay visible in production. This filter is the only place a
 * request that ends in an error is logged — the LoggingInterceptor only sees the
 * success path.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);
  private readonly identify: KeyIdentifier;
  private readonly authEnabled: boolean;

  /**
   * `config` is optional so a spec can construct the filter bare; without it the
   * method-not-allowed upgrade simply never fires, which is the safe direction.
   */
  constructor(config?: AppConfiguration) {
    this.authEnabled = config?.apiAuth.enabled ?? false;
    this.identify = createKeyIdentifier(config?.apiAuth.keys ?? []);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const resolved = this.upgradeMethodNotAllowed(request, response, resolveError(exception));

    this.logException(request, resolved, exception);

    const body: ErrorBody = { ...resolved, timestamp: new Date().toISOString(), path: request.url };
    response.status(resolved.statusCode).json(body);
  }

  /**
   * Nest answers **404** when a known path is called with an unsupported verb,
   * because Express finds no handler for it. `POST /search` deserves a **405**
   * with an `Allow` header — but only for a caller who has already proved it may
   * know the route exists.
   *
   * To an unauthenticated stranger, 405 and 404 are different answers: one
   * confirms `/search` is real. On a private API that is disclosure, so the
   * upgrade applies only when authentication is off or the request carries a
   * valid key.
   */
  private upgradeMethodNotAllowed(
    request: Request,
    response: Response,
    resolved: ResolvedError,
  ): ResolvedError {
    // Plain numeric literal, like logException below: statusCode is a number and
    // comparing it against the enum trips no-unsafe-enum-comparison.
    if (resolved.statusCode !== 404) {
      return resolved;
    }
    if (!isApiPath(request.url) || isAllowedMethod(request.method)) {
      return resolved;
    }
    if (this.authEnabled && this.identify(presentedKey(request)) === undefined) {
      return resolved;
    }
    response.setHeader('Allow', ALLOW_HEADER_VALUE);
    return {
      statusCode: HttpStatus.METHOD_NOT_ALLOWED,
      error: 'Method Not Allowed',
      message: `${request.method} is not supported on this endpoint; use ${ALLOW_HEADER_VALUE}`,
    };
  }

  private logException(request: Request, resolved: ResolvedError, exception: unknown): void {
    // Plain numeric bounds, not HttpStatus members: statusCode is a number and
    // comparing it against the enum trips no-unsafe-enum-comparison.
    const line = `${request.method} ${pathWithoutQuery(request.url)} -> ${resolved.statusCode}`;
    if (resolved.statusCode >= 500) {
      this.logger.error(line, exception instanceof Error ? exception.stack : String(exception));
      return;
    }
    if (resolved.statusCode >= 400) {
      this.logger.warn(`${line} ${messageSummary(resolved)}`);
    }
  }
}

function presentedKey(request: Request): string | undefined {
  const header = request.headers[API_KEY_HEADER];
  return Array.isArray(header) ? header[0] : header;
}

function resolveError(exception: unknown): ResolvedError {
  if (exception instanceof HttpException) {
    return fromHttpException(exception);
  }
  if (exception instanceof ResultWindowExceededError) {
    return {
      statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
      error: 'Unprocessable Entity',
      message: exception.message,
    };
  }
  if (exception instanceof UpstreamResponseError) {
    return {
      statusCode: HttpStatus.BAD_GATEWAY,
      error: 'Bad Gateway',
      message: 'Search engine error',
    };
  }
  if (exception instanceof ApplicationError || exception instanceof DomainError) {
    return { statusCode: HttpStatus.BAD_REQUEST, error: 'Bad Request', message: exception.message };
  }
  if (exception instanceof esErrors.ResponseError) {
    return fromElasticsearchResponse(exception);
  }
  if (exception instanceof esErrors.ElasticsearchClientError) {
    return {
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      error: 'Service Unavailable',
      message: 'Search engine unavailable',
    };
  }
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    error: 'Internal Server Error',
    message: 'Internal server error',
  };
}

/**
 * Elasticsearch answered, but not with results. A **400 from the engine** means
 * the request built from the client's input was rejected — bad input, not an
 * upstream failure — so it must not surface as a 502: that would report a healthy
 * cluster as broken and log a stack for something a client caused. Every other
 * status stays a 502: a 404 is a missing index, a 401/403 is our credentials, a
 * 5xx is the cluster itself, and none of those are the caller's doing.
 *
 * The DTO length caps (`input-limits.ts`) keep the known trigger from reaching
 * Elasticsearch at all; this is the classification for whatever else gets through.
 */
function fromElasticsearchResponse(exception: esErrors.ResponseError): ResolvedError {
  if (exception.statusCode === HttpStatus.BAD_REQUEST) {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      error: 'Bad Request',
      message: 'Invalid search query',
    };
  }
  return {
    statusCode: HttpStatus.BAD_GATEWAY,
    error: 'Bad Gateway',
    message: 'Search engine error',
  };
}

function fromHttpException(exception: HttpException): ResolvedError {
  const statusCode = exception.getStatus();
  const responseBody = exception.getResponse();
  if (typeof responseBody === 'string') {
    return { statusCode, error: exception.name, message: responseBody };
  }
  const body = responseBody as { message?: string | string[]; error?: string };
  const error = typeof body.error === 'string' ? body.error : exception.name;
  if (Array.isArray(body.message)) {
    return { statusCode, error, message: 'Validation failed', details: body.message };
  }
  return { statusCode, error, message: body.message ?? exception.message };
}

/** Compact reason for the 4xx warning line: validation details win, else the message. */
function messageSummary(resolved: ResolvedError): string {
  if (resolved.details && resolved.details.length > 0) {
    return resolved.details.join('; ');
  }
  return Array.isArray(resolved.message) ? resolved.message.join('; ') : resolved.message;
}
