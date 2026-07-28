import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Span } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { type ObservabilityConfig } from '@config/app-config';
import {
  buildTracingConfig,
  commandNameOnly,
  redactIncomingQuery,
  startTracing,
  stopTracing,
} from './tracing.bootstrap';

const BASE_ENV = {
  ELASTICSEARCH_NODE: 'http://localhost:9200',
  API_AUTH_ENABLED: 'false',
  REDIS_URL: 'redis://localhost:6379',
};

const OBSERVABILITY: ObservabilityConfig = {
  logLevel: 'info',
  logPretty: false,
  metricsEnabled: true,
  otlpHeaders: {},
  serviceName: 'advanced-search-api',
  tracesSamplerRatio: 1,
  metricsExportEnabled: false,
  metricExportIntervalMs: 60000,
};

describe('commandNameOnly', () => {
  /** As the instrumentation calls it: `(name, args)`, the extra one discarded. */
  const asSerializer = commandNameOnly as unknown as (name: string, args: unknown[]) => string;

  it('keeps the operation and drops every argument', () => {
    // Arrange & Act & Assert: the default serializer writes the whole command,
    // which on the cache path is `SET <key> <the entire serialized response>`.
    expect(asSerializer('get', ['search:v1:abc:def'])).toBe('get');
    expect(asSerializer('set', ['search:v1:abc:def', '{"items":[…]}', 'EX', '300'])).toBe('set');
  });

  it('does not leak a cached payload or key into the span', () => {
    // Arrange
    const payload = JSON.stringify({ items: [{ name: 'cordless drill', price: 89 }] });

    // Act
    const statement = asSerializer('set', ['search:v1:abc:def', payload, 'EX', '300']);

    // Assert
    expect(statement).not.toContain('cordless drill');
    expect(statement).not.toContain('search:v1');
  });

  it('is the serializer the Redis instrumentation is actually built with', () => {
    // Arrange & Act: wiring it and never attaching it would look identical here
    // otherwise — the production span is what proved the default leaks.
    const config = buildTracingConfig({
      ...OBSERVABILITY,
      otlpEndpoint: 'https://otlp.example.com',
    });
    const ioredis: any = config?.instrumentations?.find((instrumentation: any) =>
      instrumentation.instrumentationName?.includes('ioredis'),
    );

    // Assert
    expect(ioredis.getConfig().dbStatementSerializer).toBe(commandNameOnly);
  });
});

describe('buildTracingConfig', () => {
  it('declares an empty reader list so the SDK cannot start a metrics pipeline too', () => {
    // Arrange & Act
    const config = buildTracingConfig({
      ...OBSERVABILITY,
      otlpEndpoint: 'https://otlp.example.com',
    });

    // Assert: leaving this unset makes NodeSDK read OTEL_METRICS_EXPORTER,
    // which defaults to otlp — an OTLP endpoint set for *tracing* then also
    // ships the HTTP instrumentation's histograms, as it did in production
    // until 2026-07-27. Present-and-empty is what skips the MeterProvider.
    expect(config?.metricReaders).toEqual([]);
  });

  it('builds nothing at all without an endpoint, so no exporter is ever constructed', () => {
    // Arrange & Act & Assert
    expect(buildTracingConfig(OBSERVABILITY)).toBeUndefined();
  });

  it('redacts client-controlled query values on incoming HTTP spans', () => {
    // Arrange
    const span = { setAttribute: jest.fn() } as unknown as Span;

    // Act
    redactIncomingQuery(span, { url: '/search?q=private-term&category=secret' } as never);

    // Assert
    expect(span.setAttribute).toHaveBeenCalledWith('url.query', '[REDACTED]');
  });

  it('does not add a query attribute when the incoming URL has none', () => {
    // Arrange
    const span = { setAttribute: jest.fn() } as unknown as Span;

    // Act
    redactIncomingQuery(span, { url: '/search' } as never);

    // Assert
    expect(span.setAttribute).not.toHaveBeenCalled();
  });
});

describe('startTracing (design D25)', () => {
  const original = process.env;

  beforeEach(() => {
    process.env = { ...BASE_ENV };
    jest.spyOn(NodeSDK.prototype, 'start').mockImplementation(() => undefined);
    jest.spyOn(NodeSDK.prototype, 'shutdown').mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await stopTracing();
    process.env = original;
    jest.restoreAllMocks();
  });

  it('does nothing at all when no OTLP endpoint is configured', () => {
    // Arrange & Act
    const started = startTracing();

    // Assert: this is what lets CI and the e2e suites run without a collector.
    expect(started).toBe(false);
    expect(NodeSDK.prototype.start).not.toHaveBeenCalled();
  });

  it('starts the SDK once an endpoint is configured', () => {
    // Arrange
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';

    // Act
    const started = startTracing();

    // Assert
    expect(started).toBe(true);
    expect(NodeSDK.prototype.start).toHaveBeenCalledTimes(1);
  });

  it('fails fast on an invalid sampling ratio instead of tracing silently wrong', () => {
    // Arrange
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';
    process.env.OTEL_TRACES_SAMPLER_RATIO = '7';

    // Act & Assert
    expect(() => startTracing()).toThrow(/Invalid environment configuration/);
  });

  it('shuts down cleanly, and tolerates being stopped when it never started', async () => {
    // Arrange
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'https://otlp.example.com';
    startTracing();

    // Act
    await stopTracing();
    await stopTracing();

    // Assert
    expect(NodeSDK.prototype.shutdown).toHaveBeenCalledTimes(1);
  });
});

describe('main.ts import order', () => {
  it('imports an eager tracing preload before anything that loads http, Express or a client', () => {
    // Arrange: importing main.ts would boot the application, so assert both
    // halves of the contract: early import and eager execution in that module.
    const source = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    const preload = readFileSync(join(__dirname, 'tracing.preload.ts'), 'utf8');
    const imports = source
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .map((line) => line.trim());

    // Act
    const tracingIndex = imports.findIndex((line) => line.includes('tracing.preload'));
    const nestIndex = imports.findIndex((line) => line.includes('@nestjs/core'));

    // Assert
    expect(imports[0]).toContain('reflect-metadata');
    expect(tracingIndex).toBe(1);
    expect(tracingIndex).toBeLessThan(nestIndex);
    expect(preload).toContain('export const tracingStarted = startTracing();');
  });
});
