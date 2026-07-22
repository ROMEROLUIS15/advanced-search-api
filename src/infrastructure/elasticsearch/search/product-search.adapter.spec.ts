import { Client } from '@elastic/elasticsearch';
import { ElasticsearchProductSearchAdapter } from './product-search.adapter';
import { ResultWindowExceededError } from '@application/errors/application.error';
import { buildConfig, type AppConfiguration } from '@config/app-config';
import { validateEnv } from '@config/env.schema';
import type { SearchCriteria } from '@application/models/search-criteria';

const config: AppConfiguration = buildConfig(
  validateEnv({
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    REDIS_URL: 'redis://localhost:6379',
  }),
);

const criteria = (overrides: Partial<SearchCriteria> = {}): SearchCriteria => ({
  query: 'drill',
  filters: {},
  sort: 'relevance',
  order: 'desc',
  page: 1,
  pageSize: 20,
  ...overrides,
});

function adapterWith(search: jest.Mock): ElasticsearchProductSearchAdapter {
  return new ElasticsearchProductSearchAdapter({ search } as unknown as Client, config);
}

describe('ElasticsearchProductSearchAdapter', () => {
  it('maps hits to a search outcome with total and empty facets/suggestions', async () => {
    // Arrange
    const search = jest.fn().mockResolvedValue({
      hits: {
        total: { value: 1, relation: 'eq' },
        hits: [
          {
            _id: 'tool-001',
            _score: 3.2,
            _source: {
              id: 'tool-001',
              name: 'Cordless Drill',
              description: 'd',
              category: 'Tools',
              subcategories: ['Drills'],
              location: 'Berlin',
              price: 129.99,
              popularity: 480,
              createdAt: '2026-05-10T09:00:00.000Z',
            },
          },
        ],
      },
    });

    // Act
    const outcome = await adapterWith(search).search(criteria());

    // Assert
    expect(outcome.total).toBe(1);
    expect(outcome.items[0]).toMatchObject({
      id: 'tool-001',
      price: 129.99,
      currency: 'USD',
      score: 3.2,
    });
    expect(outcome.facets).toEqual({
      categories: [],
      subcategories: [],
      locations: [],
      priceRanges: [],
    });
    expect(outcome.suggestions).toEqual({ didYouMean: null, related: [] });
  });

  it('maps facet aggregations into the outcome facets', async () => {
    // Arrange
    const search = jest.fn().mockResolvedValue({
      hits: { total: { value: 0 }, hits: [] },
      aggregations: {
        categories: { values: { buckets: [{ key: 'Tools', doc_count: 2 }] } },
        subcategories: { values: { buckets: [] } },
        locations: { values: { buckets: [{ key: 'Berlin', doc_count: 1 }] } },
        priceRanges: { values: { buckets: [{ to: 50, doc_count: 2 }] } },
      },
    });

    // Act
    const outcome = await adapterWith(search).search(criteria());

    // Assert
    expect(outcome.facets.categories).toEqual([{ key: 'Tools', count: 2 }]);
    expect(outcome.facets.locations).toEqual([{ key: 'Berlin', count: 1 }]);
    expect(outcome.facets.priceRanges).toEqual([{ to: 50, count: 2 }]);
  });

  it('throws ResultWindowExceededError beyond max_result_window without calling ES', async () => {
    // Arrange: from = 500 * 20 = 10000; from + size = 10020 > 10000
    const search = jest.fn();
    const adapter = adapterWith(search);

    // Act & Assert
    await expect(adapter.search(criteria({ page: 501, pageSize: 20 }))).rejects.toBeInstanceOf(
      ResultWindowExceededError,
    );
    expect(search).not.toHaveBeenCalled();
  });
});
