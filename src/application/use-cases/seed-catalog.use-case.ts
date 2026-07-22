import { Inject, Injectable } from '@nestjs/common';
import type { Product } from '@domain/product/product.entity';
import type { BulkResult } from '../models/bulk-result';
import { PRODUCT_INDEX_PORT, type ProductIndexPort } from '../ports/product-index.port';

/**
 * Provisions the index (idempotent) and bulk-loads the catalog. Idempotent on
 * re-run: `ensureIndex` is a no-op when the alias exists and documents upsert by id.
 */
@Injectable()
export class SeedCatalogUseCase {
  constructor(@Inject(PRODUCT_INDEX_PORT) private readonly index: ProductIndexPort) {}

  async execute(products: Product[]): Promise<BulkResult> {
    await this.index.ensureIndex();
    const result = await this.index.bulkIndex(products);
    await this.index.refresh();
    return result;
  }
}
