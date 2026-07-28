import type { OnApplicationShutdown } from '@nestjs/common';
import type { MetricsExporterPort, MetricsPort } from '@application/ports/metrics.port';
import type { OtlpMetricsAdapter } from './otlp-metrics.adapter';
import type { PrometheusMetricsAdapter } from './prometheus-metrics.adapter';

/**
 * Records every measurement twice — once for `GET /metrics`, once for the OTLP
 * backend — so a call site still knows about neither (design D35).
 *
 * A composite rather than two libraries inside one adapter: the Prometheus
 * registry keeps serving the scrape endpoint the load test and the DAST job
 * read, the OTLP side is a file that does nothing else, and each is testable
 * without the other. What the design fixed was that **one `MetricsPort` call
 * reaches both**, which this satisfies; that it does so by delegation rather
 * than by two statements in one method is an implementation detail.
 *
 * Only the Prometheus side can render: OTLP push has nothing to serve.
 */
export class CompositeMetricsAdapter
  implements MetricsPort, MetricsExporterPort, OnApplicationShutdown
{
  constructor(
    private readonly local: PrometheusMetricsAdapter,
    private readonly remote: OtlpMetricsAdapter,
  ) {}

  observeRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    this.local.observeRequest(method, route, statusCode, durationMs);
    this.remote.observeRequest(method, route, statusCode, durationMs);
  }

  recordCacheHit(): void {
    this.local.recordCacheHit();
    this.remote.recordCacheHit();
  }

  recordCacheMiss(): void {
    this.local.recordCacheMiss();
    this.remote.recordCacheMiss();
  }

  recordRateLimitFailover(): void {
    this.local.recordRateLimitFailover();
    this.remote.recordRateLimitFailover();
  }

  render(): Promise<string> {
    return this.local.render();
  }

  get contentType(): string {
    return this.local.contentType;
  }

  /** Nest calls this because `enableShutdownHooks` is on (see `app.setup.ts`). */
  onApplicationShutdown(): Promise<void> {
    return this.remote.shutdown();
  }
}
