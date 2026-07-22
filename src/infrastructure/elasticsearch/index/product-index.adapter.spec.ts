import { Client, errors } from '@elastic/elasticsearch';
import { ProductIndexAdapter } from './product-index.adapter';
import { buildConfig, type AppConfiguration } from '@config/app-config';
import { validateEnv } from '@config/env.schema';
import { Product } from '@domain/product/product.entity';
import { Money } from '@domain/product/money.value-object';

const config: AppConfiguration = buildConfig(
  validateEnv({
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    REDIS_URL: 'redis://localhost:6379',
  }),
);

interface MockClient {
  indices: { existsAlias: jest.Mock; create: jest.Mock; refresh: jest.Mock };
  bulk: jest.Mock;
  count: jest.Mock;
}

function createMockClient(): MockClient {
  return {
    indices: {
      existsAlias: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
      refresh: jest.fn().mockResolvedValue({}),
    },
    bulk: jest.fn(),
    count: jest.fn(),
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

function alreadyExistsError(): errors.ResponseError {
  return new errors.ResponseError({
    statusCode: 400,
    body: { error: { type: 'resource_already_exists_exception' } },
    headers: {},
    warnings: null,
    meta: {},
  } as never);
}

describe('ProductIndexAdapter', () => {
  let client: MockClient;
  let adapter: ProductIndexAdapter;

  beforeEach(() => {
    client = createMockClient();
    adapter = new ProductIndexAdapter(client as unknown as Client, config);
  });

  describe('ensureIndex', () => {
    it('creates the versioned index and alias when the alias is absent', async () => {
      // Arrange
      client.indices.existsAlias.mockResolvedValue(false);

      // Act
      await adapter.ensureIndex();

      // Assert
      expect(client.indices.create).toHaveBeenCalledTimes(1);
      expect(client.indices.create).toHaveBeenCalledWith(
        expect.objectContaining({ index: 'products_v1', aliases: { products: {} } }),
      );
    });

    it('is idempotent: does not create when the alias already exists', async () => {
      // Arrange
      client.indices.existsAlias.mockResolvedValue(true);

      // Act
      await adapter.ensureIndex();

      // Assert
      expect(client.indices.create).not.toHaveBeenCalled();
    });

    it('swallows a resource_already_exists error from a concurrent create', async () => {
      // Arrange
      client.indices.existsAlias.mockResolvedValue(false);
      client.indices.create.mockRejectedValue(alreadyExistsError());

      // Act & Assert
      await expect(adapter.ensureIndex()).resolves.toBeUndefined();
    });

    it('rethrows unexpected errors', async () => {
      // Arrange
      client.indices.existsAlias.mockResolvedValue(false);
      client.indices.create.mockRejectedValue(new Error('cluster down'));

      // Act & Assert
      await expect(adapter.ensureIndex()).rejects.toThrow('cluster down');
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

  it('refresh targets the alias', async () => {
    await adapter.refresh();
    expect(client.indices.refresh).toHaveBeenCalledWith({ index: 'products' });
  });

  it('count returns the document count from the alias', async () => {
    client.count.mockResolvedValue({ count: 42 });
    await expect(adapter.count()).resolves.toBe(42);
  });
});
