import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { OPERATOR_PATHS, matchesPath } from '@shared/operator-paths';

/**
 * Logs each completed request (method, path, status, duration). Errors are
 * logged by the filter.
 *
 * Successful probes are skipped: the platform polls `/health` continuously and a
 * scraper polls `/metrics`, and a line per poll saying "still fine" is noise
 * that buries real traffic — the same reason their traces are dropped. Nothing
 * is lost by it: this interceptor uses `tap`, which only fires on success, so a
 * failing probe (a 503 from `/health`, a 401 from `/metrics`) is logged by
 * `AllExceptionsFilter` either way, and `/metrics` counts every request
 * regardless.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        if (matchesPath(request.url, OPERATOR_PATHS)) {
          return;
        }
        const response = context.switchToHttp().getResponse<Response>();
        this.logger.log(
          `${request.method} ${request.url} ${response.statusCode} ${Date.now() - startedAt}ms`,
        );
      }),
    );
  }
}
