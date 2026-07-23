import { validateEnv } from './env.schema';

const baseEnv = {
  ELASTICSEARCH_NODE: 'http://localhost:9200',
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
