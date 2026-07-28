import { validateEnv } from './env.schema';

const baseEnv = {
  ELASTICSEARCH_NODE: 'http://localhost:9200',
  API_AUTH_ENABLED: 'false',
  REDIS_URL: 'redis://localhost:6379',
};

describe('validateEnv', () => {
  it('applies defaults for optional variables', () => {
    // Arrange & Act
    const env = validateEnv({ ...baseEnv });

    // Assert
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.ELASTICSEARCH_INDEX).toBe('products');
    expect(env.CACHE_TTL_SEARCH).toBe(300);
    expect(env.SEARCH_MAX_PAGE_SIZE).toBe(100);
    expect(env.SEARCH_MAX_RESULT_WINDOW).toBe(10000);
    expect(env.ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED).toBe(true);
  });

  it('coerces numeric strings and parses booleans explicitly', () => {
    // Arrange & Act
    const env = validateEnv({
      ...baseEnv,
      PORT: '8080',
      ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED: 'false',
    });

    // Assert
    expect(env.PORT).toBe(8080);
    expect(env.ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED).toBe(false);
  });

  it('throws when a required variable is missing', () => {
    // Arrange / Act / Assert
    expect(() => validateEnv({ REDIS_URL: 'redis://localhost:6379' })).toThrow(
      /ELASTICSEARCH_NODE/,
    );
  });

  it('throws when ELASTICSEARCH_USERNAME is set without a password', () => {
    expect(() => validateEnv({ ...baseEnv, ELASTICSEARCH_USERNAME: 'elastic' })).toThrow(
      /PASSWORD/,
    );
  });

  it('rejects an invalid Elasticsearch node URL', () => {
    expect(() => validateEnv({ ...baseEnv, ELASTICSEARCH_NODE: 'not-a-url' })).toThrow();
  });

  it('rejects a max page size below the default page size', () => {
    expect(() =>
      validateEnv({ ...baseEnv, SEARCH_DEFAULT_PAGE_SIZE: '50', SEARCH_MAX_PAGE_SIZE: '20' }),
    ).toThrow(/SEARCH_MAX_PAGE_SIZE/);
  });
});

describe('validateEnv — API client keys (D30–D32)', () => {
  const authEnv = { ...baseEnv, API_AUTH_ENABLED: 'true' };
  const strong = 'k7Qz2mB9xR4tL6vP';
  const alsoStrong = 'W3nD8sF1jH5cY0aE';

  it('accepts a list of keys that all clear the minimum length', () => {
    // Arrange & Act
    const env = validateEnv({ ...authEnv, API_KEYS: `${strong}, ${alsoStrong}` });

    // Assert
    expect(env.API_KEYS).toBe(`${strong}, ${alsoStrong}`);
  });

  it('refuses a key short enough to have been typed by hand', () => {
    // Arrange & Act & Assert: this validated cleanly before the length bar existed.
    expect(() => validateEnv({ ...authEnv, API_KEYS: 'x' })).toThrow(/at least 16 characters/);
  });

  it('refuses a weak key kept alongside a strong one, as happens mid-rotation', () => {
    // Arrange & Act & Assert
    expect(() => validateEnv({ ...authEnv, API_KEYS: `${strong},temp` })).toThrow(
      /at least 16 characters/,
    );
  });

  it('never echoes the offending key in the error', () => {
    // Arrange & Act
    const attempt = (): unknown => validateEnv({ ...authEnv, API_KEYS: 'short-secret' });

    // Assert
    expect(attempt).toThrow(/API_KEYS/);
    expect(attempt).not.toThrow(/short-secret/);
  });

  it('ignores the length bar entirely when authentication is off', () => {
    // Arrange & Act
    const env = validateEnv({ ...baseEnv, API_AUTH_ENABLED: 'false', API_KEYS: 'x' });

    // Assert
    expect(env.API_AUTH_ENABLED).toBe(false);
  });

  it('still reports the missing-keys failure before the length one', () => {
    // Arrange & Act & Assert: an empty list is a different mistake and reads better
    // as "list at least one key" than as a complaint about length.
    expect(() => validateEnv({ ...authEnv, API_KEYS: ' , ' })).toThrow(
      /must list at least one key/,
    );
  });
});

describe('validateEnv — rate limiting (D14–D19)', () => {
  it('defaults to enforcement on, a one-minute window and per-endpoint budgets', () => {
    // Arrange & Act
    const env = validateEnv({ ...baseEnv });

    // Assert
    expect(env.RATE_LIMIT_ENABLED).toBe(true);
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(60);
    expect(env.RATE_LIMIT_SEARCH).toBe(60);
    expect(env.RATE_LIMIT_AUTOCOMPLETE).toBe(300);
    expect(env.RATE_LIMIT_SUGGEST).toBe(60);
    expect(env.RATE_LIMIT_DEFAULT).toBe(120);
  });

  it('trusts no proxy hop by default, so a forged header cannot claim an identity', () => {
    // Arrange & Act
    const env = validateEnv({ ...baseEnv });

    // Assert
    expect(env.TRUST_PROXY_HOPS).toBe(0);
  });

  it('parses the enable flag explicitly rather than by truthiness', () => {
    // Arrange & Act
    const disabled = validateEnv({ ...baseEnv, RATE_LIMIT_ENABLED: 'false' });

    // Assert
    expect(disabled.RATE_LIMIT_ENABLED).toBe(false);
  });

  it('coerces numeric strings for limits and hops', () => {
    // Arrange & Act
    const env = validateEnv({
      ...baseEnv,
      RATE_LIMIT_SEARCH: '10',
      RATE_LIMIT_WINDOW_SECONDS: '30',
      TRUST_PROXY_HOPS: '1',
    });

    // Assert
    expect(env.RATE_LIMIT_SEARCH).toBe(10);
    expect(env.RATE_LIMIT_WINDOW_SECONDS).toBe(30);
    expect(env.TRUST_PROXY_HOPS).toBe(1);
  });

  it.each([
    ['RATE_LIMIT_SEARCH', '0'],
    ['RATE_LIMIT_SEARCH', '-5'],
    ['RATE_LIMIT_SEARCH', 'many'],
    ['RATE_LIMIT_WINDOW_SECONDS', '0'],
    ['TRUST_PROXY_HOPS', '-1'],
    ['RATE_LIMIT_ENABLED', 'yes'],
  ])('fails fast at boot on an invalid %s of "%s"', (key, value) => {
    // Arrange & Act & Assert
    expect(() => validateEnv({ ...baseEnv, [key]: value })).toThrow(
      /Invalid environment configuration/,
    );
  });
});

describe('validateEnv — Elasticsearch resilience (D20)', () => {
  it('defaults to a 4s request timeout and a retry budget below the client default', () => {
    // Arrange & Act
    const env = validateEnv({ ...baseEnv });

    // Assert
    expect(env.ELASTICSEARCH_REQUEST_TIMEOUT_MS).toBe(4000);
    expect(env.ELASTICSEARCH_MAX_RETRIES).toBe(2);
  });

  it('coerces overrides and allows zero retries', () => {
    // Arrange & Act
    const env = validateEnv({
      ...baseEnv,
      ELASTICSEARCH_REQUEST_TIMEOUT_MS: '2500',
      ELASTICSEARCH_MAX_RETRIES: '0',
    });

    // Assert
    expect(env.ELASTICSEARCH_REQUEST_TIMEOUT_MS).toBe(2500);
    expect(env.ELASTICSEARCH_MAX_RETRIES).toBe(0);
  });

  it.each([
    ['ELASTICSEARCH_REQUEST_TIMEOUT_MS', '0'],
    ['ELASTICSEARCH_REQUEST_TIMEOUT_MS', '-1'],
    ['ELASTICSEARCH_MAX_RETRIES', '-1'],
    ['ELASTICSEARCH_MAX_RETRIES', 'lots'],
  ])('rejects an invalid %s of "%s" at boot', (key, value) => {
    // Arrange & Act & Assert
    expect(() => validateEnv({ ...baseEnv, [key]: value })).toThrow(
      /Invalid environment configuration/,
    );
  });
});

describe('validateEnv — observability (D21–D25)', () => {
  it('defaults to inert observability: info logs, JSON output, metrics on, no exporter', () => {
    // Arrange & Act
    const env = validateEnv({ ...baseEnv });

    // Assert
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.LOG_PRETTY).toBe(false);
    expect(env.METRICS_ENABLED).toBe(true);
    expect(env.METRICS_TOKEN).toBeUndefined();
    expect(env.OTEL_EXPORTER_OTLP_ENDPOINT).toBeUndefined();
    expect(env.OTEL_TRACES_SAMPLER_RATIO).toBe(0.1);
  });

  it('refuses to expose enabled metrics without a token in production', () => {
    expect(() => validateEnv({ ...baseEnv, NODE_ENV: 'production' })).toThrow(/METRICS_TOKEN/);
  });

  it('accepts enabled production metrics when a token is configured', () => {
    const env = validateEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      METRICS_TOKEN: 'metrics-secret',
    });

    expect(env.METRICS_ENABLED).toBe(true);
    expect(env.METRICS_TOKEN).toBe('metrics-secret');
  });

  it('does not require a token when production metrics are disabled', () => {
    const env = validateEnv({
      ...baseEnv,
      NODE_ENV: 'production',
      METRICS_ENABLED: 'false',
    });

    expect(env.METRICS_ENABLED).toBe(false);
    expect(env.METRICS_TOKEN).toBeUndefined();
  });

  it('leaves both shipping pipelines off by default', () => {
    // Arrange & Act
    const env = validateEnv({ ...baseEnv });

    // Assert: this is what keeps CI, the e2e suites and a local run backend-free.
    expect(env.OTEL_METRICS_EXPORT_ENABLED).toBe(false);
    expect(env.LOKI_URL).toBeUndefined();
    expect(env.OTEL_METRIC_EXPORT_INTERVAL_MS).toBe(60000);
  });

  it('refuses metrics export without somewhere to export to', () => {
    // Arrange & Act & Assert: a reader that fails every flush, silently.
    expect(() => validateEnv({ ...baseEnv, OTEL_METRICS_EXPORT_ENABLED: 'true' })).toThrow(
      /OTEL_EXPORTER_OTLP_ENDPOINT/,
    );
  });

  it('accepts metrics export alongside the tracing endpoint they share', () => {
    // Arrange & Act
    const env = validateEnv({
      ...baseEnv,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
      OTEL_METRICS_EXPORT_ENABLED: 'true',
    });

    // Assert
    expect(env.OTEL_METRICS_EXPORT_ENABLED).toBe(true);
  });

  it('leaves tracing alone when only an endpoint is set, shipping no metrics', () => {
    // Arrange & Act: the accident this default exists to prevent.
    const env = validateEnv({
      ...baseEnv,
      OTEL_EXPORTER_OTLP_ENDPOINT: 'https://otlp.example.com',
    });

    // Assert
    expect(env.OTEL_METRICS_EXPORT_ENABLED).toBe(false);
  });

  it('refuses half a Loki credential', () => {
    // Arrange & Act & Assert: Loki would 401 every batch, invisibly.
    expect(() =>
      validateEnv({ ...baseEnv, LOKI_URL: 'https://logs.example.com', LOKI_USERNAME: '12345' }),
    ).toThrow(/LOKI_USERNAME and LOKI_PASSWORD/);
  });

  it('refuses credentials with no Loki to send them to', () => {
    // Arrange & Act & Assert
    expect(() =>
      validateEnv({ ...baseEnv, LOKI_USERNAME: '12345', LOKI_PASSWORD: 'glc_token' }),
    ).toThrow(/LOKI_URL/);
  });

  it('accepts a Loki URL with no credentials, as a local Loki has none', () => {
    // Arrange & Act
    const env = validateEnv({ ...baseEnv, LOKI_URL: 'http://localhost:3100' });

    // Assert
    expect(env.LOKI_URL).toBe('http://localhost:3100');
    expect(env.LOKI_USERNAME).toBeUndefined();
  });

  it.each([
    ['OTEL_TRACES_SAMPLER_RATIO', '-0.1'],
    ['OTEL_TRACES_SAMPLER_RATIO', '1.5'],
    ['OTEL_TRACES_SAMPLER_RATIO', 'always'],
    ['OTEL_EXPORTER_OTLP_ENDPOINT', 'not-a-url'],
    ['LOG_LEVEL', 'verbose'],
    ['LOG_PRETTY', 'yes'],
    ['METRICS_ENABLED', '1'],
    ['METRICS_TOKEN', ''],
    ['METRICS_TOKEN', '   '],
    ['LOKI_URL', 'not-a-url'],
    ['OTEL_METRICS_EXPORT_ENABLED', 'yes'],
    ['OTEL_METRIC_EXPORT_INTERVAL_MS', '0'],
    ['OTEL_METRIC_EXPORT_INTERVAL_MS', 'often'],
  ])('fails fast at boot on an invalid %s of "%s"', (key, value) => {
    // Arrange & Act & Assert
    expect(() => validateEnv({ ...baseEnv, [key]: value })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
