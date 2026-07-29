import { SeedCatalogUseCase } from './seed-catalog.use-case';
import type { ProductIndexPort } from '../ports/product-index.port';
import type { BulkResult } from '../models/bulk-result';
import type { IndexPreparation, IndexPublication } from '../models/index-migration';

const MIGRATING: IndexPreparation = { action: 'migrating', version: 2, replacedVersion: 1 };
const PUBLISHED: IndexPublication = {
  published: true,
  version: 2,
  retainedVersion: 1,
  prunedVersions: [],
};

function createIndexPort(
  bulkResult: BulkResult,
  calls: string[],
  preparation: IndexPreparation = MIGRATING,
): ProductIndexPort {
  return {
    ensureIndex: jest.fn(async () => {
      calls.push('ensure');
      return preparation;
    }),
    bulkIndex: jest.fn(async () => {
      calls.push('bulk');
      return bulkResult;
    }),
    refresh: jest.fn(async () => {
      calls.push('refresh');
    }),
    count: jest.fn(async () => 0),
    publishIndex: jest.fn(async () => {
      calls.push('publish');
      return PUBLISHED;
    }),
  };
}

describe('SeedCatalogUseCase', () => {
  it('ensures the index, bulk-indexes, refreshes, then publishes — in that order', async () => {
    // Arrange
    const calls: string[] = [];
    const bulkResult: BulkResult = { total: 2, indexed: 2, failed: 0, failures: [] };
    const index = createIndexPort(bulkResult, calls);
    const useCase = new SeedCatalogUseCase(index);
    const products = [{}, {}] as never[];

    // Act
    const outcome = await useCase.execute(products);

    // Assert
    expect(calls).toEqual(['ensure', 'bulk', 'refresh', 'publish']);
    expect(index.bulkIndex).toHaveBeenCalledWith(products);
    expect(outcome.bulk).toBe(bulkResult);
    expect(outcome.preparation).toBe(MIGRATING);
    expect(outcome.publication).toBe(PUBLISHED);
  });

  it('publishes even when nothing migrated, because publishing is then a no-op', async () => {
    // Arrange
    const calls: string[] = [];
    const unchanged: IndexPreparation = { action: 'unchanged', version: 1 };
    const index = createIndexPort(
      { total: 1, indexed: 1, failed: 0, failures: [] },
      calls,
      unchanged,
    );

    // Act
    const outcome = await new SeedCatalogUseCase(index).execute([{}] as never[]);

    // Assert
    expect(calls).toContain('publish');
    expect(outcome.preparation).toBe(unchanged);
  });

  it('does NOT publish a load that lost documents, so the alias keeps serving the old version', async () => {
    // Arrange
    const calls: string[] = [];
    const bulkResult: BulkResult = {
      total: 2,
      indexed: 1,
      failed: 1,
      failures: [{ id: 'p-2', reason: 'bad value' }],
    };
    const index = createIndexPort(bulkResult, calls);

    // Act
    const outcome = await new SeedCatalogUseCase(index).execute([{}, {}] as never[]);

    // Assert
    expect(calls).toEqual(['ensure', 'bulk', 'refresh']);
    expect(index.publishIndex).not.toHaveBeenCalled();
    expect(outcome.publication).toBeUndefined();
    expect(outcome.bulk).toBe(bulkResult);
  });
});
