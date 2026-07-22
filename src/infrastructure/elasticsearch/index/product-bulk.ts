import type { estypes } from '@elastic/elasticsearch';
import type { Product } from '@domain/product/product.entity';
import type { BulkFailure, BulkResult } from '@application/models/bulk-result';
import { type ProductDocument, toProductDocument } from './product-document';

type BulkOperation = estypes.BulkOperationContainer | ProductDocument;

/** Builds bulk operations that upsert each product by its id (action line + document line). */
export function buildBulkOperations(products: Product[], index: string): BulkOperation[] {
  const operations: BulkOperation[] = [];
  for (const product of products) {
    operations.push({ index: { _index: index, _id: product.id } });
    operations.push(toProductDocument(product));
  }
  return operations;
}

/** Reduces a bulk response into a {@link BulkResult}, surfacing per-document failures. */
export function summarizeBulkResponse(response: estypes.BulkResponse, total: number): BulkResult {
  const failures: BulkFailure[] = [];
  for (const item of response.items) {
    const operation = item.index ?? item.create;
    if (operation?.error) {
      failures.push({
        id: operation._id ?? 'unknown',
        reason: operation.error.reason ?? operation.error.type ?? 'unknown error',
      });
    }
  }
  return { total, indexed: total - failures.length, failed: failures.length, failures };
}
