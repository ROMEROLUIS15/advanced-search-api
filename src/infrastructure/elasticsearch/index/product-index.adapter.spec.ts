import { Client, errors } from '@elastic/elasticsearch';
import { ProductIndexAdapter } from './product-index.adapter';
import { productIndexDefinition } from './product-index.mapping';
import { fingerprintDefinition } from './index-definition.fingerprint';
import { IndexMigrationError } from './index-migration.error';
import { buildConfig, type AppConfiguration } from '@config/app-config';
import { validateEnv } from '@config/env.schema';
import { Product } from '@domain/product/product.entity';
import { Money } from '@domain/product/money.value-object';

const config: AppConfiguration = buildConfig(
  validateEnv({
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    API_AUTH_ENABLED: 'false',
    REDIS_URL: 'redis://localhost:6379',
  }),
);

const CURRENT_FINGERPRINT = fingerprintDefinition(productIndexDefinition());

interface MockClient {
  indices: {
    existsAlias: jest.Mock;
    getMapping: jest.Mock;
    create: jest.Mock;
    putAlias: jest.Mock;
    updateAliases: jest.Mock;
    refresh: jest.Mock;
    get: jest.Mock;
    delete: jest.Mock;
  };
  bulk: jest.Mock;
  count: jest.Mock;
}

function createMockClient(): MockClient {
  return {
    indices: {
      existsAlias: jest.fn().mockResolvedValue(true),
      getMapping: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      putAlias: jest.fn().mockResolvedValue({}),
      updateAliases: jest.fn().mockResolvedValue({}),
      refresh: jest.fn().mockResolvedValue({}),
      get: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
    },
    bulk: jest.fn(),
    count: jest.fn(),
  };
}

/** The shape `getMapping({ index: alias })` really answers — keyed by physical name. */
function liveIndex(version: number, fingerprint: string | undefined): Record<string, unknown> {
  const { mappings } = productIndexDefinition();
  return {
    [`products_v${version}`]: {
      mappings:
        fingerprint === undefined
          ? mappings
          : { ...mappings, _meta: { definitionFingerprint: fingerprint } },
    },
  };
}

function makeProduct(id: string): Product {
  return Product.create({
    id,
    name: `Product ${id}`,
    description: 'desc',
    category: 'Tools',
    subcategories: ['Power Tools'],
    location: 'Berlin',
    price: Money.of(10),
    popularity: 1,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function esError(type: string, statusCode: number): errors.ResponseError {
  return new errors.ResponseError({
    statusCode,
    body: { error: { type } },
    headers: {},
    warnings: null,
    meta: {},
  } as never);
}

const alreadyExistsError = (): errors.ResponseError =>
  esError('resource_already_exists_exception', 400);
const notFoundError = (): errors.ResponseError => esError('index_not_found_exception', 404);

describe('ProductIndexAdapter', () => {
  let client: MockClient;
  let adapter: ProductIndexAdapter;

  beforeEach(() => {
    client = createMockClient();
    adapter = new ProductIndexAdapter(client as unknown as Client, config);
  });

  describe('ensureIndex — first provisioning', () => {
    it('creates the versioned index with the alias attached inline', async () => {
      // Arrange
      client.indices.getMapping.mockRejectedValue(notFoundError());

      // Act
      const preparation = await adapter.ensureIndex();

      // Assert
      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'products_v1', aliases: { products: {} } }),
      );
      expect(preparation).toEqual({ action: 'created', version: 1 });
    });

    it('records the definition fingerprint on the index it creates', async () => {
      // Arrange
      client.indices.getMapping.mockRejectedValue(notFoundError());

      // Act
      await adapter.ensureIndex();

      // Assert
      const [[created]] = client.indices.create.mock.calls as [[{ mappings: { _meta: unknown } }]];
      expect(created.mappings._meta).toEqual({ definitionFingerprint: CURRENT_FINGERPRINT });
    });

    it('accepts a concurrent create that also installed the alias', async () => {
      // Arrange
      client.indices.getMapping.mockRejectedValue(notFoundError());
      client.indices.create.mockRejectedValue(alreadyExistsError());
      client.indices.existsAlias.mockResolvedValue(true);

      // Act
      const preparation = await adapter.ensureIndex();

      // Assert
      expect(client.indices.putAlias).not.toHaveBeenCalled();
      expect(preparation.action).toBe('created');
    });

    it('repairs a physical index left without its alias', async () => {
      // Arrange
      client.indices.getMapping.mockRejectedValue(notFoundError());
      client.indices.create.mockRejectedValue(alreadyExistsError());
      client.indices.existsAlias.mockResolvedValue(false);

      // Act
      await adapter.ensureIndex();

      // Assert
      expect(client.indices.putAlias).toHaveBeenCalledWith({
        index: 'products_v1',
        name: 'products',
      });
    });

    it('rethrows unexpected errors', async () => {
      // Arrange
      client.indices.getMapping.mockRejectedValue(new Error('cluster down'));

      // Act & Assert
      await expect(adapter.ensureIndex()).rejects.toThrow('cluster down');
    });
  });

  describe('ensureIndex — an unchanged definition', () => {
    it('creates nothing when the live fingerprint matches', async () => {
      // Arrange
      client.indices.getMapping.mockResolvedValue(liveIndex(3, CURRENT_FINGERPRINT));

      // Act
      const preparation = await adapter.ensureIndex();

      // Assert
      expect(client.indices.create).not.toHaveBeenCalled();
      expect(preparation).toEqual({ action: 'unchanged', version: 3 });
    });
  });

  describe('ensureIndex — a changed definition', () => {
    it('creates the next version WITHOUT the alias, so reads keep their index', async () => {
      // Arrange
      client.indices.getMapping.mockResolvedValue(liveIndex(1, 'a-stale-fingerprint'));

      // Act
      const preparation = await adapter.ensureIndex();

      // Assert
      const [[created]] = client.indices.create.mock.calls as [[Record<string, unknown>]];
      expect(created.index).toBe('products_v2');
      expect(created).not.toHaveProperty('aliases');
      expect(client.indices.updateAliases).not.toHaveBeenCalled();
      expect(preparation).toEqual({ action: 'migrating', version: 2, replacedVersion: 1 });
    });

    it('migrates an index provisioned before fingerprints existed', async () => {
      // Arrange — products_v1 in production carries no _meta at all
      client.indices.getMapping.mockResolvedValue(liveIndex(1, undefined));

      // Act
      const preparation = await adapter.ensureIndex();

      // Assert
      expect(preparation).toEqual({ action: 'migrating', version: 2, replacedVersion: 1 });
    });

    it('refuses to load into an index another migration is already filling', async () => {
      // Arrange
      client.indices.getMapping.mockResolvedValue(liveIndex(1, 'a-stale-fingerprint'));
      client.indices.create.mockRejectedValue(alreadyExistsError());

      // Act & Assert
      await expect(adapter.ensureIndex()).rejects.toThrow(IndexMigrationError);
    });

    it('refuses to migrate an alias pointing at more than one index', async () => {
      // Arrange
      client.indices.getMapping.mockResolvedValue({
        ...liveIndex(1, CURRENT_FINGERPRINT),
        ...liveIndex(2, CURRENT_FINGERPRINT),
      });

      // Act & Assert
      await expect(adapter.ensureIndex()).rejects.toThrow(IndexMigrationError);
    });

    it('refuses to guess a version from an unconventional index name', async () => {
      // Arrange
      client.indices.getMapping.mockResolvedValue({ products_hand_made: { mappings: {} } });

      // Act & Assert
      await expect(adapter.ensureIndex()).rejects.toThrow(IndexMigrationError);
    });
  });

  describe('write target', () => {
    it('writes and refreshes through the alias when nothing is pending', async () => {
      // Arrange
      client.indices.getMapping.mockResolvedValue(liveIndex(1, CURRENT_FINGERPRINT));
      client.bulk.mockResolvedValue({
        errors: false,
        took: 1,
        items: [{ index: { _id: 'p-1', status: 201 } }],
      });
      await adapter.ensureIndex();

      // Act
      await adapter.bulkIndex([makeProduct('p-1')]);
      await adapter.refresh();

      // Assert
      const [[bulkCall]] = client.bulk.mock.calls as [
        [{ operations: { index: { _index: string } }[] }],
      ];
      expect(bulkCall.operations[0].index._index).toBe('products');
      expect(client.indices.refresh).toHaveBeenCalledWith({ index: 'products' });
    });

    it('writes and refreshes into the pending version during a migration', async () => {
      // Arrange
      client.indices.getMapping.mockResolvedValue(liveIndex(1, 'a-stale-fingerprint'));
      client.bulk.mockResolvedValue({
        errors: false,
        took: 1,
        items: [{ index: { _id: 'p-1', status: 201 } }],
      });
      await adapter.ensureIndex();

      // Act
      await adapter.bulkIndex([makeProduct('p-1')]);
      await adapter.refresh();

      // Assert
      const [[bulkCall]] = client.bulk.mock.calls as [
        [{ operations: { index: { _index: string } }[] }],
      ];
      expect(bulkCall.operations[0].index._index).toBe('products_v2');
      expect(client.indices.refresh).toHaveBeenCalledWith({ index: 'products_v2' });
    });
  });

  describe('publishIndex', () => {
    async function startMigration(fromVersion: number): Promise<void> {
      client.indices.getMapping.mockResolvedValue(liveIndex(fromVersion, 'a-stale-fingerprint'));
      await adapter.ensureIndex();
    }

    it('moves the alias in a single atomic call carrying both actions', async () => {
      // Arrange
      await startMigration(1);

      // Act
      const publication = await adapter.publishIndex();

      // Assert
      expect(client.indices.updateAliases).toHaveBeenCalledTimes(1);
      expect(client.indices.updateAliases).toHaveBeenCalledWith({
        actions: [
          { remove: { index: 'products_v1', alias: 'products' } },
          { add: { index: 'products_v2', alias: 'products' } },
        ],
      });
      expect(publication).toEqual({
        published: true,
        version: 2,
        retainedVersion: 1,
        prunedVersions: [],
      });
    });

    it('keeps the replaced version and deletes only the ones older than it', async () => {
      // Arrange
      await startMigration(3);
      client.indices.get.mockResolvedValue({
        products_v1: {},
        products_v2: {},
        products_v3: {},
        products_v4: {},
      });

      // Act
      const publication = await adapter.publishIndex();

      // Assert
      expect(client.indices.delete).toHaveBeenCalledWith({ index: 'products_v1' });
      expect(client.indices.delete).toHaveBeenCalledWith({ index: 'products_v2' });
      expect(client.indices.delete).toHaveBeenCalledTimes(2);
      expect(publication.retainedVersion).toBe(3);
      expect(publication.prunedVersions).toEqual([1, 2]);
    });

    it('leaves an index it cannot make sense of alone rather than deleting it', async () => {
      // Arrange
      await startMigration(2);
      client.indices.get.mockResolvedValue({ products_v1: {}, products_vX: {}, products_v2: {} });

      // Act
      await adapter.publishIndex();

      // Assert
      expect(client.indices.delete).toHaveBeenCalledTimes(1);
      expect(client.indices.delete).toHaveBeenCalledWith({ index: 'products_v1' });
    });

    it('is a no-op when no migration is pending', async () => {
      // Arrange
      client.indices.getMapping.mockResolvedValue(liveIndex(2, CURRENT_FINGERPRINT));
      await adapter.ensureIndex();

      // Act
      const publication = await adapter.publishIndex();

      // Assert
      expect(client.indices.updateAliases).not.toHaveBeenCalled();
      expect(publication).toEqual({ published: false, version: 2, prunedVersions: [] });
    });

    it('refuses to publish before anything was prepared', async () => {
      // Act & Assert
      await expect(adapter.publishIndex()).rejects.toThrow(IndexMigrationError);
    });
  });

  describe('bulkIndex', () => {
    it('returns per-document failures parsed from the bulk response', async () => {
      // Arrange
      client.bulk.mockResolvedValue({
        errors: true,
        took: 1,
        items: [
          { index: { _id: 'p-1', status: 201 } },
          { index: { _id: 'p-2', status: 400, error: { type: 'x', reason: 'bad value' } } },
        ],
      });

      // Act
      const result = await adapter.bulkIndex([makeProduct('p-1'), makeProduct('p-2')]);

      // Assert
      expect(result).toEqual({
        total: 2,
        indexed: 1,
        failed: 1,
        failures: [{ id: 'p-2', reason: 'bad value' }],
      });
    });

    it('short-circuits an empty batch without calling Elasticsearch', async () => {
      // Act
      const result = await adapter.bulkIndex([]);

      // Assert
      expect(client.bulk).not.toHaveBeenCalled();
      expect(result).toEqual({ total: 0, indexed: 0, failed: 0, failures: [] });
    });
  });

  it('count returns the document count from the served index', async () => {
    client.count.mockResolvedValue({ count: 42 });
    await expect(adapter.count()).resolves.toBe(42);
    expect(client.count).toHaveBeenCalledWith({ index: 'products' });
  });
});
