/** DI token for recording metrics from application code (design D24). */
export const METRICS_PORT = Symbol('METRICS_PORT');

/** DI token for rendering the collected metrics; consumed only by the endpoint. */
export const METRICS_EXPORTER = Symbol('METRICS_EXPORTER');

/**
 * What the application is allowed to count (design D24).
 *
 * Kept deliberately narrow and free of any Prometheus vocabulary: `application/`
 * may not import an infrastructure library, so this port is what lets a use-case
 * count a cache hit without knowing a registry exists. A no-op implementation is
 * bound when metrics are disabled, so no call site ever branches.
 */
export interface MetricsPort {
  /** One finished HTTP request. `route` must be the matched pattern, never the raw URL. */
  observeRequest(method: string, route: string, statusCode: number, durationMs: number): void;
  recordCacheHit(): void;
  recordCacheMiss(): void;
  /** The rate-limit counter fell over from Redis to the in-process store (design D14). */
  recordRateLimitFailover(): void;
}

/** Exposition side of the same registry, separated so use-cases cannot render metrics. */
export interface MetricsExporterPort {
  render(): Promise<string>;
  readonly contentType: string;
}
