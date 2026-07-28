/**
 * Endpoints the platform calls, not clients: the readiness probe and the metrics
 * scrape. They are polled continuously and say nothing about the service's work,
 * so three places treat them apart — the request log skips their success lines,
 * the tracer drops their traces, and the rate limiter exempts `/health` (only
 * `/health`: a scraper fits inside the default budget, and exempting it would
 * hand an authenticated-but-unlimited endpoint to anyone with the token).
 *
 * One list, one matcher, so the three cannot drift.
 */
export const OPERATOR_PATHS = ['/health', '/metrics'] as const;

/** Removes client-controlled query parameters before a path is matched or logged. */
export function pathWithoutQuery(path: string): string {
  const queryStart = path.indexOf('?');
  return queryStart === -1 ? path : path.slice(0, queryStart);
}

/**
 * Exact match or sub-path, never a bare `startsWith`: `/healthy-products` is a
 * plausible future route and is not a probe. The query string is ignored.
 */
export function matchesPath(path: string, prefixes: readonly string[]): boolean {
  const withoutQuery = pathWithoutQuery(path);
  return prefixes.some(
    (prefix) => withoutQuery === prefix || withoutQuery.startsWith(`${prefix}/`),
  );
}
