import type { Product } from '@domain/product/product.entity';
import type { BulkResult } from '../models/bulk-result';
import type { IndexPreparation, IndexPublication } from '../models/index-migration';

export const PRODUCT_INDEX_PORT = Symbol('PRODUCT_INDEX_PORT');

export interface ProductIndexPort {
  /**
   * Idempotent. Creates the versioned index (mapping + analyzers) and alias when
   * absent, and prepares a new version when the live one no longer carries the
   * current definition (design D43). Preparing does **not** move the alias: reads
   * keep being served by the version in place until `publishIndex` runs.
   */
  ensureIndex(): Promise<IndexPreparation>;
  /**
   * Upsert products by id; per-document failures are reported in the result.
   * Writes land in the prepared version while a migration is pending, so a
   * migration never touches the index still serving reads.
   */
  bulkIndex(products: Product[]): Promise<BulkResult>;
  refresh(): Promise<void>;
  count(): Promise<number>;
  /**
   * Points the alias at the prepared version in a single atomic operation and
   * prunes versions older than the one it replaces (design D45/D47). A no-op when
   * no migration is pending. Call only after a complete load: publishing a partial
   * one would serve an incomplete catalogue (design D46).
   */
  publishIndex(): Promise<IndexPublication>;
}
