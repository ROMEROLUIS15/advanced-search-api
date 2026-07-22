import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApplicationError, ResultWindowExceededError } from '@application/errors/application.error';
import { DomainError } from '@domain/errors/domain.error';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  timestamp: string;
  path: string;
}

interface ResolvedError {
  statusCode: number;
  error: string;
  message: string | string[];
}

/**
 * Global exception filter (design D10). Maps typed errors and Nest HTTP
 * exceptions into a consistent body and never leaks internals on unknown errors.
 * Extended in group 13 with upstream (ES/Redis) 502/503 mapping and logging.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const resolved = resolveError(exception);

    const body: ErrorBody = {
      ...resolved,
      timestamp: new Date().toISOString(),
      path: request.url,
    };
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
  return {
    statusCode,
    error: typeof body.error === 'string' ? body.error : exception.name,
    message: body.message ?? exception.message,
  };
}
