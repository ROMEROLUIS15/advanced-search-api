import { Injectable } from '@nestjs/common';
import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';
import type { MetricsExporterPort, MetricsPort } from '@application/ports/metrics.port';

/**
 * Buckets in seconds, chosen from the measured profile rather than the library
 * default: the cached path answers around 5 ms and the heaviest facet query
 * around 33 ms, so the resolution has to be where the traffic actually is.
 * The tail buckets exist to make a degradation obvious, not to be precise.
 */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

/**
 * `prom-client` implementation of both metrics ports (design D24).
 *
 * Uses its own `Registry` rather than the library's global one so that nothing
 * leaks between test suites and a second instance cannot collide on metric
 * names.
 */
@Injectable()
export class PrometheusMetricsAdapter implements MetricsPort, MetricsExporterPort {
  private readonly registry = new Registry();
  private readonly requests: Counter<'method' | 'route' | 'status'>;
  private readonly duration: Histogram<'method' | 'route' | 'status'>;
  private readonly cacheEvents: Counter<'result'>;
  private readonly rateLimitFailovers: Counter<string>;

  constructor() {
    collectDefaultMetrics({ register: this.registry });

    this.requests = new Counter({
      name: 'http_requests_total',
      help: 'HTTP requests by method, matched route and status code',
      labelNames: ['method', 'route', 'status'],
      registers: [this.registry],
    });
    this.duration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'HTTP request duration by method, matched route and status code',
      labelNames: ['method', 'route', 'status'],
      buckets: DURATION_BUCKETS,
      registers: [this.registry],
    });
    this.cacheEvents = new Counter({
      name: 'search_cache_events_total',
      help: 'Cache-aside outcomes (design D8), labelled hit or miss',
      labelNames: ['result'],
      registers: [this.registry],
    });
    this.rateLimitFailovers = new Counter({
      name: 'rate_limit_failover_total',
      help: 'Times the rate-limit counter fell over from Redis to memory (design D14)',
      registers: [this.registry],
    });
  }

  observeRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const labels = { method, route, status: String(statusCode) };
    this.requests.inc(labels);
    this.duration.observe(labels, durationMs / 1000);
  }

  recordCacheHit(): void {
    this.cacheEvents.inc({ result: 'hit' });
  }

  recordCacheMiss(): void {
    this.cacheEvents.inc({ result: 'miss' });
  }

  recordRateLimitFailover(): void {
    this.rateLimitFailovers.inc();
  }

  render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
