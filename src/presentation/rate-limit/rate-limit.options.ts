import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { RateLimitConfig } from '@config/app-config';
import { matchesPath } from '@shared/operator-paths';
import { API_KEY_HEADER, type KeyIdentifier } from '@presentation/auth/api-key.identity';

interface RoutedRequest {
  path?: string;
  url?: string;
}

interface TrackedRequest {
  ip?: string;
  socket?: { remoteAddress?: string };
  headers?: Record<string, string | string[] | undefined>;
}

/**
 * Readiness probing is never throttled (design D17). Deliberately **not** every
 * operator path: `/metrics` stays inside the limiter, because a scraper fits in
 * the default budget and exempting it would leave an unlimited endpoint open.
 */
const EXEMPT_PATHS = ['/health'];

/**
 * Builds the throttler configuration from {@link RateLimitConfig}.
 *
 * One throttler with a *resolvable* limit rather than several named ones: with
 * multiple throttlers every route is subject to all of them, whereas resolving
 * the budget per request gives each endpoint its own ceiling. The keys stay
 * independent regardless, because the generated key includes the controller and
 * handler — exhausting `/search` therefore cannot exhaust `/autocomplete`.
 */
export function buildThrottlerOptions(
  config: RateLimitConfig,
  identify: KeyIdentifier,
): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: 'default',
        ttl: config.windowSeconds * 1000,
        limit: (context: ExecutionContext): number => resolveLimit(context, config),
      },
    ],
    // Covers both the health exemption (D17) and the runtime switch (D19).
    skipIf: (context: ExecutionContext): boolean =>
      !config.enabled || isExempt(requestPath(context)),
    // Set here rather than overridden on the guard because the identity needs
    // the configured keys, and this is where configuration already is.
    getTracker: (req: Record<string, unknown>): Promise<string> =>
      Promise.resolve(resolveTracker(req as TrackedRequest, identify)),
  };
}

/**
 * Who a budget is counted against (design D34): the client behind a **valid**
 * API key when there is one, its address otherwise.
 *
 * Only a valid key earns its own bucket — otherwise a caller could mint a fresh
 * budget per request by inventing a key, which is precisely the flood the
 * limiter exists to stop. An unauthenticated attempt therefore still counts
 * against the address it came from.
 */
export function resolveTracker(request: TrackedRequest, identify: KeyIdentifier): string {
  const header = request.headers?.[API_KEY_HEADER];
  const presented = Array.isArray(header) ? header[0] : header;
  const clientId = identify(presented);
  if (clientId !== undefined) {
    return clientId;
  }
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
}

export function resolveLimit(context: ExecutionContext, config: RateLimitConfig): number {
  const path = requestPath(context);
  if (path.startsWith('/search')) {
    return config.search;
  }
  if (path.startsWith('/autocomplete')) {
    return config.autocomplete;
  }
  if (path.startsWith('/suggest')) {
    return config.suggest;
  }
  return config.default;
}

export function isExempt(path: string): boolean {
  return matchesPath(path, EXEMPT_PATHS);
}

/** The routed path without its query string. */
function requestPath(context: ExecutionContext): string {
  const request = context.switchToHttp().getRequest<RoutedRequest>();
  const raw = request.path ?? request.url ?? '';
  const queryStart = raw.indexOf('?');
  return queryStart === -1 ? raw : raw.slice(0, queryStart);
}
