import {
  type CallHandler,
  type ExecutionContext,
  Inject,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Observable } from 'rxjs';
import { METRICS_PORT, type MetricsPort } from '@application/ports/metrics.port';

/**
 * Records the RED metrics for every request (design D24).
 *
 * Measurement hangs off the response's `finish` event rather than an rxjs
 * operator: `tap` fires only on the success path (the same blind spot that once
 * left 4xx unlogged), and even `finalize` runs before `AllExceptionsFilter` has
 * written the status, so an error would be counted with whatever status the
 * response happened to carry. `finish` is the one moment the status is final.
 *
 * The route label is the *matched pattern* (`/search`), never `request.url`,
 * which carries the query string — labelling by raw URL would give the registry
 * one time series per distinct query.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(@Inject(METRICS_PORT) private readonly metrics: MetricsPort) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.metrics.observeRequest(
        request.method,
        routeLabel(request),
        response.statusCode,
        durationMs,
      );
    });

    return next.handle();
  }
}

/** The matched route pattern, or a single bucket for everything unrouted. */
function routeLabel(request: Request): string {
  // `route` is typed loosely by Express and is absent entirely on a 404.
  const route = request.route as { path?: unknown } | undefined;
  const path = route?.path;
  return typeof path === 'string' && path.length > 0 ? path : 'unmatched';
}
