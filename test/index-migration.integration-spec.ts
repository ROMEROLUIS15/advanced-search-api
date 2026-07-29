import { Client } from '@elastic/elasticsearch';
import { buildConfig, type AppConfiguration } from '../src/config/app-config';
import { validateEnv } from '../src/config/env.schema';
import { createElasticsearchClient } from '../src/infrastructure/elasticsearch/client/elasticsearch.client.factory';
import { ProductIndexAdapter } from '../src/infrastructure/elasticsearch/index/product-index.adapter';
import { productIndexDefinition } from '../src/infrastructure/elasticsearch/index/product-index.mapping';
import { buildBulkOperations } from '../src/infrastructure/elasticsearch/index/product-bulk';
import { SeedCatalogUseCase } from '../src/application/use-cases/seed-catalog.use-case';
import { searchCacheScope } from '../src/application/caching/cache-scope';
import { Product } from '../src/domain/product/product.entity';
import { Money } from '../src/domain/product/money.value-object';

/**
 * The migration path against a real cluster (design D43-D49). The "previous
 * definition" is simulated the way production actually looks: a `_v1` carrying a
 * fingerprint that is not the current one — which is also what an index
 * provisioned before D43 looks like, since it carries none at all.
 */
const ALIASES = [
  'products_mig_flip',
  'products_mig_atomic',
  'products_mig_partial',
  'products_mig_scope',
];

function config(alias: string): AppConfiguration {
  return buildConfig(
    validateEnv({
      ELASTICSEARCH_NODE: process.env.ELASTICSEARCH_NODE ?? 'http://localhost:9200',
      ELASTICSEARCH_INDEX: alias,
      REDIS_URL: 'redis://localhost:6379',
      API_AUTH_ENABLED: 'false',
    }),
  );
}

function makeProduct(id: string, name: string, popularity = 100): Product {
  return Product.create({
    id,
    name,
    description: `${name} for professionals`,
    category: 'Tools',
    subcategories: ['Drills'],
    location: 'Berlin',
    price: Money.of(129.99),
    popularity,
    createdAt: new Date('2026-05-01T00:00:00.000Z'),
  });
}

const DRILL = makeProduct('mig-1', 'Cordless Drill');
const SANDER = makeProduct('mig-2', 'Belt Sander');
/** `popularity` is an unbounded non-negative integer in the domain and an
 *  `integer` in the mapping, so this document is valid to us and rejected by
 *  Elasticsearch — a genuine per-document failure, not a mocked one. */
const OVERFLOWING = makeProduct('mig-3', 'Overflowing Popularity', 3_000_000_000);

async function dropVersions(client: Client, alias: string): Promise<void> {
  const found = await client.indices.get({
    index: `${alias}_v*`,
    ignore_unavailable: true,
    allow_no_indices: true,
  });
  for (const name of Object.keys(found)) {
    await client.indices.delete({ index: name });
  }
}

/** A `_v1` behind the alias whose recorded definition is not the current one. */
async function provisionPreviousVersion(
  client: Client,
  alias: string,
  products: Product[],
): Promise<void> {
  const { settings, mappings } = productIndexDefinition();
  await client.indices.create({
    index: `${alias}_v1`,
    settings,
    mappings: { ...mappings, _meta: { definitionFingerprint: 'a-previous-definition' } },
    aliases: { [alias]: {} },
  });
  await client.bulk({ operations: buildBulkOperations(products, alias), refresh: true });
}

async function aliasTargets(client: Client, alias: string): Promise<string[]> {
  return Object.keys(await client.indices.getAlias({ name: alias }));
}

async function servedIds(client: Client, alias: string): Promise<string[]> {
  const response = await client.search<{ id: string }>({ index: alias, query: { match_all: {} } });
  return response.hits.hits.map((hit) => hit._source?.id ?? '').sort();
}

describe('Versioned index migration (integration)', () => {
  const client = createElasticsearchClient(config(ALIASES[0]));

  beforeAll(async () => {
    for (const alias of ALIASES) {
      await dropVersions(client, alias);
    }
  });

  afterAll(async () => {
    for (const alias of ALIASES) {
      await dropVersions(client, alias);
    }
    await client.close();
  });

  it('creates the next version, moves the alias onto it and retains the previous one', async () => {
    // Arrange — v1 serves two products under a definition that is no longer current
    const alias = 'products_mig_flip';
    const cfg = config(alias);
    await provisionPreviousVersion(client, alias, [DRILL, SANDER]);
    const adapter = new ProductIndexAdapter(client, cfg);

    // Act — the dataset now omits SANDER, which is how a product is retired
    const preparation = await adapter.ensureIndex();
    const bulk = await adapter.bulkIndex([DRILL]);
    await adapter.refresh();
    const publication = await adapter.publishIndex();

    // Assert
    expect(preparation).toEqual({ action: 'migrating', version: 2, replacedVersion: 1 });
    expect(bulk.failed).toBe(0);
    expect(publication).toEqual({
      published: true,
      version: 2,
      retainedVersion: 1,
      prunedVersions: [],
    });
    await expect(aliasTargets(client, alias)).resolves.toEqual([`${alias}_v2`]);
    await expect(client.indices.exists({ index: `${alias}_v1` })).resolves.toBe(true);

    // The retired product is gone by construction, the surviving one is served (D48)
    await expect(servedIds(client, alias)).resolves.toEqual(['mig-1']);
  });

  it('re-running with an unchanged definition migrates nothing', async () => {
    // Arrange — the previous test left v2 carrying the current fingerprint
    const alias = 'products_mig_flip';
    const adapter = new ProductIndexAdapter(client, config(alias));

    // Act
    const preparation = await adapter.ensureIndex();
    const publication = await adapter.publishIndex();

    // Assert
    expect(preparation).toEqual({ action: 'unchanged', version: 2 });
    expect(publication.published).toBe(false);
    await expect(aliasTargets(client, alias)).resolves.toEqual([`${alias}_v2`]);
  });

  it('never lets the alias resolve to anything but exactly one index', async () => {
    // Arrange
    const alias = 'products_mig_atomic';
    await provisionPreviousVersion(client, alias, [DRILL]);
    const adapter = new ProductIndexAdapter(client, config(alias));
    await adapter.ensureIndex();
    await adapter.bulkIndex([DRILL, SANDER]);
    await adapter.refresh();

    // Act — poll the alias for the whole duration of the flip. A remove-then-add
    // written as two calls passes every other assertion in this file and fails here.
    const observations: number[] = [];
    let polling = true;
    const poller = (async (): Promise<void> => {
      while (polling) {
        try {
          observations.push((await aliasTargets(client, alias)).length);
        } catch {
          observations.push(0);
        }
      }
    })();

    await adapter.publishIndex();
    polling = false;
    await poller;

    // Assert
    expect(observations.length).toBeGreaterThan(0);
    expect(observations.every((count) => count === 1)).toBe(true);
    await expect(aliasTargets(client, alias)).resolves.toEqual([`${alias}_v2`]);
  });

  it('leaves the alias on the old version when documents fail to index', async () => {
    // Arrange
    const alias = 'products_mig_partial';
    await provisionPreviousVersion(client, alias, [DRILL]);
    const useCase = new SeedCatalogUseCase(new ProductIndexAdapter(client, config(alias)));

    // Act
    const outcome = await useCase.execute([SANDER, OVERFLOWING]);

    // Assert — a stale catalogue, never a partial one (D46)
    expect(outcome.bulk.failed).toBe(1);
    expect(outcome.publication).toBeUndefined();
    await expect(aliasTargets(client, alias)).resolves.toEqual([`${alias}_v1`]);
    await expect(servedIds(client, alias)).resolves.toEqual(['mig-1']);
  });

  it('does not change the cache scope, which is why D49 accepts a stale window', async () => {
    // Arrange
    const alias = 'products_mig_scope';
    const cfg = config(alias);
    await provisionPreviousVersion(client, alias, [DRILL]);
    const adapter = new ProductIndexAdapter(client, cfg);
    const scopeBefore = searchCacheScope(cfg);

    // Act
    await adapter.ensureIndex();
    await adapter.bulkIndex([DRILL, SANDER]);
    await adapter.refresh();
    await adapter.publishIndex();

    // Assert — the scope digests the alias and the relevance config, and a
    // migration changes neither, so entries written before the flip stay servable
    // until their TTL expires. Deliberate (D49), not an oversight.
    expect(searchCacheScope(cfg)).toBe(scopeBefore);
  });
});
