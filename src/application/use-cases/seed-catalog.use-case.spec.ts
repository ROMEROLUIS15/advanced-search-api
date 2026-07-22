import { SeedCatalogUseCase } from './seed-catalog.use-case';
import type { ProductIndexPort } from '../ports/product-index.port';
import type { BulkResult } from '../models/bulk-result';

describe('SeedCatalogUseCase', () => {
  it('ensures the index, bulk-indexes, then refreshes — in that order', async () => {
    // Arrange
    const calls: string[] = [];
    const bulkResult: BulkResult = { total: 2, indexed: 2, failed: 0, failures: [] };
    const index: ProductIndexPort = {
      ensureIndex: jest.fn(async () => {
        calls.push('ensure');
      }),
      bulkIndex: jest.fn(async () => {
        calls.push('bulk');
        return bulkResult;
      }),
      refresh: jest.fn(async () => {
        calls.push('refresh');
      }),
      count: jest.fn(async () => 0),
    };
    const useCase = new SeedCatalogUseCase(index);
    const products = [{}, {}] as never[];

    // Act
    const result = await useCase.execute(products);

    // Assert
    expect(calls).toEqual(['ensure', 'bulk', 'refresh']);
    expect(index.bulkIndex).toHaveBeenCalledWith(products);
    expect(result).toBe(bulkResult);
  });
});
