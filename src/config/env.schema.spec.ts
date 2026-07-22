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
