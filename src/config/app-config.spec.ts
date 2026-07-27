import { buildConfig } from './app-config';
import { validateEnv } from './env.schema';

describe('buildConfig', () => {
  it('maps validated env into namespaced config and splits CORS origins', () => {
    // Arrange
    const env = validateEnv({
      ELASTICSEARCH_NODE: 'http://localhost:9200',
      REDIS_URL: 'redis://localhost:6379',
      CORS_ORIGINS: 'http://a.com, http://b.com ,',
    });

    // Act
    const config = buildConfig(env);

    // Assert
    expect(config.app.corsOrigins).toEqual(['http://a.com', 'http://b.com']);
    expect(config.elasticsearch.index).toBe('products');
    expect(config.cache.searchTtlSeconds).toBe(300);
    expect(config.search.maxResultWindow).toBe(10000);
    expect(config.relevance.recencyScale).toBe('90d');
  });

  it('yields an empty origin list when CORS_ORIGINS is unset', () => {
    // Arrange
    const env = validateEnv({
      ELASTICSEARCH_NODE: 'http://localhost:9200',
      REDIS_URL: 'redis://localhost:6379',
    });

    // Act
    const config = buildConfig(env);

    // Assert
    expect(config.app.corsOrigins).toEqual([]);
  });
});

describe('buildConfig — rate limiting', () => {
  it('maps the rate limit env into its own namespace', () => {
    // Arrange
    const env = validateEnv({
      ELASTICSEARCH_NODE: 'http://localhost:9200',
      REDIS_URL: 'redis://localhost:6379',
      RATE_LIMIT_SEARCH: '5',
      RATE_LIMIT_ENABLED: 'false',
      TRUST_PROXY_HOPS: '1',
    });

    // Act
    const config = buildConfig(env);

    // Assert
    expect(config.rateLimit.enabled).toBe(false);
    expect(config.rateLimit.search).toBe(5);
    expect(config.rateLimit.autocomplete).toBe(300);
    expect(config.rateLimit.windowSeconds).toBe(60);
    expect(config.rateLimit.trustProxyHops).toBe(1);
  });
});

describe('buildConfig — Elasticsearch resilience', () => {
  it('maps the timeout and retry budget into the elasticsearch namespace', () => {
    // Arrange
    const env = validateEnv({
      ELASTICSEARCH_NODE: 'http://localhost:9200',
      REDIS_URL: 'redis://localhost:6379',
      ELASTICSEARCH_REQUEST_TIMEOUT_MS: '3000',
      ELASTICSEARCH_MAX_RETRIES: '1',
    });

    // Act
    const config = buildConfig(env);

    // Assert
    expect(config.elasticsearch.requestTimeoutMs).toBe(3000);
    expect(config.elasticsearch.maxRetries).toBe(1);
  });
});

describe('buildConfig — observability', () => {
  const base = {
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('maps the observability env into its own namespace', () => {
    // Arrange
    const env = validateEnv({
      ...base,
      LOG_LEVEL: 'debug',
      LOG_PRETTY: 'true',
      METRICS_TOKEN: 'secret',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
      OTEL_TRACES_SAMPLER_RATIO: '0.25',
    });

    // Act
    const config = buildConfig(env);

    // Assert
    expect(config.observability).toMatchObject({
      logLevel: 'debug',
      logPretty: true,
      metricsEnabled: true,
      metricsToken: 'secret',
      otlpEndpoint: 'https://otlp.example.com',
      serviceName: 'advanced-search-api',
      tracesSamplerRatio: 0.25,
    });
  });

  it('parses OTLP headers, keeping base64 padding and skipping malformed pairs', () => {
    // Arrange: a Grafana Cloud credential is base64 and contains "=" itself.
    const env = validateEnv({
      ...base,
      OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic dXNlcjpwYXNz==, broken ,X-Scope= tenant ',
    });

    // Act
    const config = buildConfig(env);

    // Assert
    expect(config.observability.otlpHeaders).toEqual({
      Authorization: 'Basic dXNlcjpwYXNz==',
      'X-Scope': 'tenant',
    });
  });

  it('yields no headers and no endpoint when nothing is configured', () => {
    // Arrange & Act
    const config = buildConfig(validateEnv({ ...base }));

    // Assert
    expect(config.observability.otlpHeaders).toEqual({});
    expect(config.observability.otlpEndpoint).toBeUndefined();
  });
});
