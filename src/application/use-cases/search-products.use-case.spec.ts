import { SearchProductsUseCase } from './search-products.use-case';
import type { ProductSearchPort } from '../ports/product-search.port';
import type { CachePort } from '../ports/cache.port';
import type { SearchOutcome } from '../models/search-outcome';
import type { SearchCriteria } from '../models/search-criteria';
import { buildConfig, type AppConfiguration } from '@config/app-config';
import { validateEnv } from '@config/env.schema';

const config: AppConfiguration = buildConfig(
  validateEnv({
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    REDIS_URL: 'redis://localhost:6379',
  }),
);

const outcome: SearchOutcome = {
  items: [],
  total: 0,
  facets: { categories: [], subcategories: [], locations: [], priceRanges: [] },
  suggestions: { didYouMean: null, related: [] },
};

const criteria: SearchCriteria = {
  filters: {},
  sort: 'relevance',
  order: 'desc',
  page: 1,
  pageSize: 20,
};

function makeCache(overrides: Partial<CachePort> = {}): CachePort {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeSearchPort(): ProductSearchPort {
  return { search: jest.fn().mockResolvedValue(outcome) };
}

describe('SearchProductsUseCase', () => {
  it('returns the cached outcome on a hit without querying Elasticsearch', async () => {
    const cache = makeCache({ get: jest.fn().mockResolvedValue(outcome) });
    const port = makeSearchPort();

    const result = await new SearchProductsUseCase(port, cache, config).execute(criteria);

    expect(result).toBe(outcome);
    expect(port.search).not.toHaveBeenCalled();
  });

  it('queries Elasticsearch on a miss and writes to the cache', async () => {
    const cache = makeCache();
    const port = makeSearchPort();

    const result = await new SearchProductsUseCase(port, cache, config).execute(criteria);

    expect(result).toBe(outcome);
    expect(port.search).toHaveBeenCalledWith(criteria);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });

  it('fails open when the cache read throws (still returns ES results)', async () => {
    const cache = makeCache({ get: jest.fn().mockRejectedValue(new Error('redis down')) });
    const port = makeSearchPort();

    const result = await new SearchProductsUseCase(port, cache, config).execute(criteria);

    expect(result).toBe(outcome);
    expect(port.search).toHaveBeenCalledTimes(1);
  });

  it('fails open when the cache write throws', async () => {
    const cache = makeCache({ set: jest.fn().mockRejectedValue(new Error('redis down')) });
    const port = makeSearchPort();

    await expect(new SearchProductsUseCase(port, cache, config).execute(criteria)).resolves.toBe(
      outcome,
    );
  });
});
