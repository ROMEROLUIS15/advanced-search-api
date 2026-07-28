import type { Counter, Histogram } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resources } from '@opentelemetry/sdk-node';
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import type { ObservabilityConfig } from '@config/app-config';
import type { MetricsPort } from '@application/ports/metrics.port';

/** Same buckets as the Prometheus registry, so the two views agree (in seconds). */
const DURATION_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5];

/**
 * Ships the service's own metrics to an OTLP backend (design D35).
 *
 * **Its `MeterProvider` is deliberately not the global one.** Instrumentation
 * libraries resolve their meters from the global provider, so leaving it unset
 * is what keeps their undeclared histograms out of the backend — the exact
 * series that arrived by accident and were removed in `1452e7b`. Everything here
 * is an instrument this service declares on purpose.
 *
 * Metrics and traces share the OTLP gateway and credential; only the signal path
 * differs, and the exporter appends `/v1/metrics` the same way the trace
 * exporter appends `/v1/traces`.
 */
export class OtlpMetricsAdapter implements MetricsPort {
  private readonly provider: MeterProvider;
  private readonly requests: Counter;
  private readonly duration: Histogram;
  private readonly cacheEvents: Counter;
  private readonly rateLimitFailovers: Counter;

  constructor(config: ObservabilityConfig, endpoint: string) {
    this.provider = new MeterProvider({
      resource: resources.resourceFromAttributes({ 'service.name': config.serviceName }),
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            url: `${endpoint.replace(/\/$/, '')}/v1/metrics`,
            headers: config.otlpHeaders,
          }),
          exportIntervalMillis: config.metricExportIntervalMs,
        }),
      ],
    });

    const meter = this.provider.getMeter(config.serviceName);
    this.requests = meter.createCounter('http_requests_total', {
      description: 'HTTP requests by method, matched route and status code',
    });
    this.duration = meter.createHistogram('http_request_duration_seconds', {
      description: 'HTTP request duration by method, matched route and status code',
      unit: 's',
      advice: { explicitBucketBoundaries: DURATION_BUCKETS },
    });
    this.cacheEvents = meter.createCounter('search_cache_events_total', {
      description: 'Cache-aside outcomes (design D8), labelled hit or miss',
    });
    this.rateLimitFailovers = meter.createCounter('rate_limit_failover_total', {
      description: 'Times the rate-limit counter fell over from Redis to memory (design D14)',
    });
  }

  observeRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const attributes = { method, route, status: String(statusCode) };
    this.requests.add(1, attributes);
    this.duration.record(durationMs / 1000, attributes);
  }

  recordCacheHit(): void {
    this.cacheEvents.add(1, { result: 'hit' });
  }

  recordCacheMiss(): void {
    this.cacheEvents.add(1, { result: 'miss' });
  }

  recordRateLimitFailover(): void {
    this.rateLimitFailovers.add(1);
  }

  /**
   * Flushes and stops the reader. Without it the last interval's samples die
   * with the process, which on a redeploy is exactly the window someone is
   * looking at. Errors are swallowed: shipping is best-effort and a failing
   * flush must not turn a clean shutdown into a crash (design D36's rule,
   * applied here too).
   */
  async shutdown(): Promise<void> {
    try {
      await this.provider.shutdown();
    } catch {
      // A backend that is already gone cannot be told we are leaving.
    }
  }
}
