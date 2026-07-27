import { Injectable } from '@nestjs/common';
import type { MetricsExporterPort, MetricsPort } from '@application/ports/metrics.port';

/**
 * Bound when `METRICS_ENABLED=false` (design D24). Its whole purpose is that no
 * call site has to ask whether metrics are on: the counters are always there,
 * they simply go nowhere. The endpoint still answers, with an empty body, so a
 * scraper pointed at a disabled instance gets a clear 200 rather than a 404 it
 * would have to interpret.
 */
@Injectable()
export class NoopMetricsAdapter implements MetricsPort, MetricsExporterPort {
  observeRequest(): void {
    // Intentionally empty.
  }

  recordCacheHit(): void {
    // Intentionally empty.
  }

  recordCacheMiss(): void {
    // Intentionally empty.
  }

  recordRateLimitFailover(): void {
    // Intentionally empty.
  }

  render(): Promise<string> {
    return Promise.resolve('');
  }

  get contentType(): string {
    return 'text/plain; charset=utf-8';
  }
}
