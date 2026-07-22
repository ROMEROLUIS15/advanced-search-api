import { Product } from '@domain/product/product.entity';
import { Money } from '@domain/product/money.value-object';

/** Raw product record as authored in the seed JSON fixture. */
export interface RawProduct {
  id: string;
  name: string;
  description: string;
  category: string;
  subcategories: string[];
  location: string;
  price: number;
  popularity: number;
  createdAt: string;
}

export interface InvalidRecord {
  id: string | undefined;
  reason: string;
}

export interface DatasetLoadResult {
  products: Product[];
  invalid: InvalidRecord[];
}

/**
 * Builds domain products from raw records, collecting invalid ones (with a
 * reason) instead of throwing — so a bad record never aborts the whole seed.
 */
export function loadProducts(records: RawProduct[]): DatasetLoadResult {
  const products: Product[] = [];
  const invalid: InvalidRecord[] = [];
  for (const record of records) {
    try {
      products.push(toProduct(record));
    } catch (error) {
      invalid.push({
        id: record?.id,
        reason: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }
  return { products, invalid };
}

function toProduct(record: RawProduct): Product {
  return Product.create({
    id: record.id,
    name: record.name,
    description: record.description,
    category: record.category,
    subcategories: record.subcategories,
    location: record.location,
    price: Money.of(record.price),
    popularity: record.popularity,
    createdAt: new Date(record.createdAt),
  });
}
