import type { NextFunction, Request, Response } from 'express';
import type { RateLimitStorePort } from '@application/ports/rate-limit-store.port';
import type { RateLimitConfig } from '@config/app-config';
import { type KeyIdentifier } from '@presentation/auth/api-key.identity';
import { resolveTracker } from '@presentation/rate-limit/rate-limit.options';

/** Its own namespace, so docs traffic cannot spend a client's `/search` budget or vice versa. */
const DOCS_BUCKET = 'docs';

/**
 * Rate limiting for the published contract (design D19's rule, applied where the
 * guard cannot reach).
 *
 * `SwaggerModule` mounts `/docs` and `/docs-json` straight onto Express, so the
 * global `RateLimitGuard` never runs for them: the contract was the one surface
 * where an attacker could try keys as fast as the network allowed. The key check
 * itself is sound — SHA-256 digests compared with `timingSafeEqual` — so this is
 * not closing a break; it is removing the only endpoint that offered unlimited
 * attempts at one, and putting docs traffic on the same footing as everything
 * else.
 *
 * **Order matters and mirrors the main pipeline.** This runs *before* the key
 * check, for the same reason `RateLimitModule` is imported before
 * `ApiAuthModule`: a flood must be counted, not rejected for free. Counting only
 * authenticated requests would leave the flood unmetered.
 *
 * Bucketing reuses `resolveTracker`, so a valid key gets its own budget and
 * everything else falls back to the address it came from — guessing keys cannot
 * mint fresh budgets.
 *
 * The 429 body is written by hand, as the 401 beside it is: these are not Nest
 * routes, so nothing thrown here would reach `AllExceptionsFilter`. The shape is
 * kept identical on purpose.
 */
export function buildDocsRateLimitMiddleware(
  store: RateLimitStorePort,
  config: RateLimitConfig,
  identify: KeyIdentifier,
): (request: Request, response: Response, next: NextFunction) => void {
  const windowMs = config.windowSeconds * 1000;

  return (request: Request, response: Response, next: NextFunction): void => {
    const key = `${DOCS_BUCKET}:${resolveTracker(request, identify)}`;

    store
      .hit(key, windowMs)
      .then((outcome) => {
        if (outcome.totalHits > config.default) {
          rejectOverBudget(response, request, outcome.timeToExpireMs);
          return;
        }
        next();
      })
      .catch(() => {
        // The store fails over rather than open (design D18); if even that
        // throws, serving the contract beats failing it — the key check is
        // still in front of the document.
        next();
      });
  };
}

function rejectOverBudget(response: Response, request: Request, timeToExpireMs: number): void {
  response.setHeader('Retry-After', Math.ceil(timeToExpireMs / 1000));
  response.status(429).json({
    statusCode: 429,
    error: 'Too Many Requests',
    message: 'Rate limit exceeded. Retry later.',
    timestamp: new Date().toISOString(),
    path: request.originalUrl,
  });
}
