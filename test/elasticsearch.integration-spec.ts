import { Client } from '@elastic/elasticsearch';
import { buildConfig, type AppConfiguration } from '../src/config/app-config';
import { validateEnv } from '../src/config/env.schema';
import { createElasticsearchClient } from '../src/infrastructure/elasticsearch/client/elasticsearch.client.factory';
import { ProductIndexAdapter } from '../src/infrastructure/elasticsearch/index/product-index.adapter';
import { ElasticsearchProductSearchAdapter } from '../src/infrastructure/elasticsearch/search/product-search.adapter';
import { ElasticsearchAutocompleteAdapter } from '../src/infrastructure/elasticsearch/autocomplete/autocomplete.adapter';
import { ElasticsearchQuerySuggestionAdapter } from '../src/infrastructure/elasticsearch/suggestion/query-suggestion.adapter';
import { Product } from '../src/domain/product/product.entity';
import { Money } from '../src/domain/product/money.value-object';
import type { SearchCriteria } from '../src/application/models/search-criteria';

const TEST_INDEX = 'products_it';
const PHYSICAL = `${TEST_INDEX}_v1`;

function config(): AppConfiguration {
  return buildConfig(
    validateEnv({
      ELASTICSEARCH_NODE: process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200',
      ELASTICSEARCH_INDEX: TEST_INDEX,
      REDIS_URL: 'redis://localhost:6379',
    }),
  );
}

function makeProduct(
  id: string,
  name: string,
  category: string,
  subcategories: string[],
  price: number,
  popularity: number,
): Product {
  return Product.create({
    id,
    name,
    description: `${name} for professionals`,
    category,
    subcategories,
    location: 'Berlin',
    price: Money.of(price),
    popularity,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
  });
}

const dataset = [
  makeProduct('it-1', 'Cordless Drill', 'Tools', ['Drills'], 129.99, 500),
  makeProduct('it-2', 'Hammer Drill', 'Tools', ['Drills'], 199, 200),
  makeProduct('it-3', 'Espresso Machine', 'Kitchen', ['Coffee'], 279, 300),
];

const criteria = (overrides: Partial<SearchCriteria> = {}): SearchCriteria => ({
  query: undefined,
  filters: {},
  sort: 'relevance',
  order: 'desc',
  page: 1,
  pageSize: 10,
  ...overrides,
});

async function dropIndex(client: Client): Promise<void> {
  if (await client.indices.exists({ index: PHYSICAL })) {
    await client.indices.delete({ index: PHYSICAL });
  }
}

describe('Elasticsearch adapters (integration)', () => {
  const cfg = config();
  const client = createElasticsearchClient(cfg);
  const index = new ProductIndexAdapter(client, cfg);
  const search = new ElasticsearchProductSearchAdapter(client, cfg);
  const autocomplete = new ElasticsearchAutocompleteAdapter(client, cfg);
  const suggestion = new ElasticsearchQuerySuggestionAdapter(client, cfg);

  beforeAll(async () => {
    await dropIndex(client);
    await index.ensureIndex();
    await index.bulkIndex(dataset);
    await index.refresh();
  });

  afterAll(async () => {
    await dropIndex(client);
    await client.close();
  });

  it('indexes and counts documents through the alias', async () => {
    await expect(index.count()).resolves.toBe(3);
  });

  it('searches by relevance and computes category facets', async () => {
    const outcome = await search.search(criteria({ query: 'drill' }));

    expect(outcome.total).toBe(2);
    expect(outcome.items.map((item) => item.id)).toEqual(expect.arrayContaining(['it-1', 'it-2']));
    expect(outcome.facets.categories.find((bucket) => bucket.key === 'Tools')?.count).toBe(2);
  });

  it('applies a filter to hits while keeping the facet full (exclude own dimension)', async () => {
    const outcome = await search.search(
      criteria({ filters: { category: 'Tools' }, sort: 'popularity' }),
    );

    expect(outcome.items.every((item) => item.category === 'Tools')).toBe(true);
    expect(outcome.facets.categories.map((bucket) => bucket.key)).toEqual(
      expect.arrayContaining(['Tools', 'Kitchen']),
    );
  });

  it('returns type-ahead completions', async () => {
    const items = await autocomplete.complete('cord', 5);
    expect(items.some((item) => item.text.toLowerCase().includes('cordless'))).toBe(true);
  });

  it('returns a well-formed suggestion block', async () => {
    const suggestions = await suggestion.suggest('driil');
    expect(suggestions).toHaveProperty('didYouMean');
    expect(Array.isArray(suggestions.related)).toBe(true);
  });
});
