import type { Product } from '@domain/product/product.entity';
import type { BulkResult } from '../models/bulk-result';

export const PRODUCT_INDEX_PORT = Symbol('PRODUCT_INDEX_PORT');

export interface ProductIndexPort {
  /** Idempotent: create the versioned index (mapping + analyzers) and alias if absent. */
  ensureIndex(): Promise<void>;
  /** Upsert products by id; per-document failures are reported in the result. */
  bulkIndex(products: Product[]): Promise<BulkResult>;
  refresh(): Promise<void>;
  count(): Promise<number>;
}
