import { Inject, Injectable } from '@nestjs/common';
import type { Product } from '@domain/product/product.entity';
import type { SeedOutcome } from '../models/seed-outcome';
import { PRODUCT_INDEX_PORT, type ProductIndexPort } from '../ports/product-index.port';

/**
 * Provisions the index and bulk-loads the catalog. Idempotent on re-run: with the
 * definition unchanged `ensureIndex` does nothing and documents upsert by id.
 *
 * When the definition *has* changed, the load lands in a freshly provisioned
 * version and is published only if every document indexed (design D46) — so the
 * failure mode is a stale catalogue, never a partial one.
 */
@Injectable()
export class SeedCatalogUseCase {
  constructor(@Inject(PRODUCT_INDEX_PORT) private readonly index: ProductIndexPort) {}

  async execute(products: Product[]): Promise<SeedOutcome> {
    const preparation = await this.index.ensureIndex();
    const bulk = await this.index.bulkIndex(products);
    await this.index.refresh();

    if (bulk.failed > 0) {
      return { bulk, preparation, publication: undefined };
    }
    return { bulk, preparation, publication: await this.index.publishIndex() };
  }
}
