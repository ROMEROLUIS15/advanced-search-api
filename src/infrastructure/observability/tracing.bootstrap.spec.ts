import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { startTracing, stopTracing } from './tracing.bootstrap';

const BASE_ENV = {
  ELASTICSEARCH_NODE: 'http://localhost:9200',
  API_AUTH_ENABLED: 'false',
  REDIS_URL: 'redis://localhost:6379',
};

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
  it('imports the tracing bootstrap before anything that loads http, Express or a client', () => {
    // Arrange: asserted on the source rather than by importing main.ts, which
    // would boot the application. Instrumentation only patches modules required
    // *after* it registers, so this ordering is load-bearing (design D25).
    const source = readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8');
    const imports = source
      .split('\n')
      .filter((line) => line.startsWith('import '))
      .map((line) => line.trim());

    // Act
    const tracingIndex = imports.findIndex((line) => line.includes('tracing.bootstrap'));
    const nestIndex = imports.findIndex((line) => line.includes('@nestjs/core'));

    // Assert
    expect(imports[0]).toContain('reflect-metadata');
    expect(tracingIndex).toBe(1);
    expect(tracingIndex).toBeLessThan(nestIndex);
  });
});
