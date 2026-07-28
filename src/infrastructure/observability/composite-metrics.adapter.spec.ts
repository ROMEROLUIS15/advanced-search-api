import { metrics } from '@opentelemetry/api';
import type { AppConfiguration } from '@config/app-config';
import { CompositeMetricsAdapter } from './composite-metrics.adapter';
import { NoopMetricsAdapter } from './noop-metrics.adapter';
import { OtlpMetricsAdapter } from './otlp-metrics.adapter';
import { PrometheusMetricsAdapter } from './prometheus-metrics.adapter';
import { buildMetricsAdapter } from './observability.module';

function configWith(overrides: Partial<AppConfiguration['observability']>): AppConfiguration {
  return {
    observability: {
      logLevel: 'info',
      logPretty: false,
      metricsEnabled: true,
      otlpHeaders: {},
      serviceName: 'advanced-search-api',
      tracesSamplerRatio: 1,
      metricsExportEnabled: false,
      metricExportIntervalMs: 60000,
      ...overrides,
    },
  } as AppConfiguration;
}

describe('buildMetricsAdapter (design D35)', () => {
  it('measures nothing when metrics are disabled', () => {
    expect(buildMetricsAdapter(configWith({ metricsEnabled: false }))).toBeInstanceOf(
      NoopMetricsAdapter,
    );
  });

  it('measures locally when export is not asked for', () => {
    expect(buildMetricsAdapter(configWith({}))).toBeInstanceOf(PrometheusMetricsAdapter);
  });

  it('does not ship metrics just because an OTLP endpoint exists for tracing', () => {
    // Arrange & Act: the accident that put undeclared series in Grafana Cloud.
    const adapter = buildMetricsAdapter(configWith({ otlpEndpoint: 'https://otlp.example.com' }));

    // Assert
    expect(adapter).toBeInstanceOf(PrometheusMetricsAdapter);
  });

  it('ships only when export is enabled and an endpoint is configured', () => {
    // Arrange & Act
    const adapter = buildMetricsAdapter(
      configWith({ metricsExportEnabled: true, otlpEndpoint: 'https://otlp.example.com' }),
    );

    // Assert
    expect(adapter).toBeInstanceOf(CompositeMetricsAdapter);
  });

  it('never registers a global meter provider, which is what keeps library metrics out', async () => {
    // Arrange: the global provider is a no-op until something sets it.
    const before = metrics.getMeterProvider();

    // Act
    const adapter = buildMetricsAdapter(
      configWith({ metricsExportEnabled: true, otlpEndpoint: 'https://otlp.example.com' }),
    );

    // Assert
    expect(metrics.getMeterProvider()).toBe(before);
    await (adapter as CompositeMetricsAdapter).onApplicationShutdown();
  });
});

describe('CompositeMetricsAdapter', () => {
  const local = {
    observeRequest: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordRateLimitFailover: jest.fn(),
    render: jest.fn().mockResolvedValue('# rendered'),
    contentType: 'text/plain',
  } as unknown as PrometheusMetricsAdapter;
  const remote = {
    observeRequest: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordRateLimitFailover: jest.fn(),
    shutdown: jest.fn().mockResolvedValue(undefined),
  } as unknown as OtlpMetricsAdapter;

  const adapter = new CompositeMetricsAdapter(local, remote);

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['observeRequest', (): void => adapter.observeRequest('GET', '/search', 200, 12)],
    ['recordCacheHit', (): void => adapter.recordCacheHit()],
    ['recordCacheMiss', (): void => adapter.recordCacheMiss()],
    ['recordRateLimitFailover', (): void => adapter.recordRateLimitFailover()],
  ])('records %s in both registries from one call', (method, act) => {
    // Act
    act();

    // Assert: the guarantee that stops the two views from drifting apart.
    expect(local[method as keyof PrometheusMetricsAdapter]).toHaveBeenCalledTimes(1);
    expect(remote[method as keyof OtlpMetricsAdapter]).toHaveBeenCalledTimes(1);
  });

  it('renders from the local registry only, because push has nothing to serve', async () => {
    await expect(adapter.render()).resolves.toBe('# rendered');
    expect(adapter.contentType).toBe('text/plain');
  });

  it('flushes the exporter on shutdown, so a redeploy does not lose the last interval', async () => {
    await adapter.onApplicationShutdown();
    expect(remote.shutdown).toHaveBeenCalledTimes(1);
  });
});

describe('OtlpMetricsAdapter', () => {
  it('records without a reachable backend and shuts down without throwing', async () => {
    // Arrange: nothing is listening on this port — export failures must stay
    // inside the exporter (spec: "an unreachable backend fails no request").
    const adapter = new OtlpMetricsAdapter(
      configWith({ metricExportIntervalMs: 60000 }).observability,
      'http://127.0.0.1:14318',
    );

    // Act & Assert
    expect(() => adapter.observeRequest('GET', '/search', 200, 5)).not.toThrow();
    expect(() => adapter.recordCacheHit()).not.toThrow();
    await expect(adapter.shutdown()).resolves.toBeUndefined();
  });
});
