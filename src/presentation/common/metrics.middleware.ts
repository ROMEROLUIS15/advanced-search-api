import type { NextFunction, Request, Response } from 'express';
import type { MetricsPort } from '@application/ports/metrics.port';

/**
 * Records the RED metrics for every request the server answers (design D24).
 *
 * An Express middleware rather than a Nest interceptor, and the difference is
 * the point: interceptors run after the global guards, so a request the API-key
 * guard or the rate limiter rejected — or one that matched no route at all —
 * was never measured. The abuse signals (401s, 429s, unmatched 404s) were
 * exactly the ones missing, confirmed against production: four unauthenticated
 * requests, zero series. Registered ahead of the router, this sees them all,
 * including anything mounted straight onto Express.
 *
 * Measurement hangs off the response's `finish` event — the one moment the
 * status is final, after `AllExceptionsFilter` has written it.
 *
 * The route label is the *matched pattern* (`/search`), read at finish time,
 * by which point Express has routed the request if it ever will. Everything
 * unrouted shares a single `unmatched` bucket — labelling by raw URL would
 * give the registry one time series per distinct query string.
 */
export function buildMetricsMiddleware(
  metrics: MetricsPort,
): (request: Request, response: Response, next: NextFunction) => void {
  return function metricsMiddleware(
    request: Request,
    response: Response,
    next: NextFunction,
  ): void {
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      metrics.observeRequest(request.method, routeLabel(request), response.statusCode, durationMs);
    });

    next();
  };
}

/** The matched route pattern, or a single bucket for everything unrouted. */
function routeLabel(request: Request): string {
  // `route` is typed loosely by Express and is absent entirely on a 404.
  const route = request.route as { path?: unknown } | undefined;
  const path = route?.path;
  return typeof path === 'string' && path.length > 0 ? path : 'unmatched';
}
