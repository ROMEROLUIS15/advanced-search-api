import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import type { RateLimitConfig } from '@config/app-config';

interface RoutedRequest {
  path?: string;
  url?: string;
}

/** Readiness probing is never throttled (design D17). */
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
export function buildThrottlerOptions(config: RateLimitConfig): ThrottlerModuleOptions {
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
  };
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
  return EXEMPT_PATHS.some((exempt) => path === exempt || path.startsWith(`${exempt}/`));
}

/** The routed path without its query string. */
function requestPath(context: ExecutionContext): string {
  const request = context.switchToHttp().getRequest<RoutedRequest>();
  const raw = request.path ?? request.url ?? '';
  const queryStart = raw.indexOf('?');
  return queryStart === -1 ? raw : raw.slice(0, queryStart);
}
