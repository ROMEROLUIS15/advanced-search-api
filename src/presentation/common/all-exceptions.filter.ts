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
import { ApplicationError, ResultWindowExceededError } from '@application/errors/application.error';
import { DomainError } from '@domain/errors/domain.error';

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
 * and Elasticsearch upstream failures into a consistent body; 5xx are logged
 * with their stack server-side while the client receives a generic message.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const resolved = resolveError(exception);

    if (resolved.statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.url} -> ${resolved.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorBody = { ...resolved, timestamp: new Date().toISOString(), path: request.url };
    response.status(resolved.statusCode).json(body);
  }
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
  if (exception instanceof ApplicationError || exception instanceof DomainError) {
    return { statusCode: HttpStatus.BAD_REQUEST, error: 'Bad Request', message: exception.message };
  }
  if (exception instanceof esErrors.ResponseError) {
    return {
      statusCode: HttpStatus.BAD_GATEWAY,
      error: 'Bad Gateway',
      message: 'Search engine error',
    };
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
