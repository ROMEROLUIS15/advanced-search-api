import type { Product } from '@domain/product/product.entity';

/** Shape of a product as stored in the Elasticsearch `_source`. */
export interface ProductDocument {
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

/** Maps a domain product to its indexed document (price as a plain number, dates ISO). */
export function toProductDocument(product: Product): ProductDocument {
  return {
    id: product.id,
    name: product.name,
    description: product.description,
    category: product.category,
    subcategories: [...product.subcategories],
    location: product.location,
    price: product.price.toNumber(),
    popularity: product.popularity,
    createdAt: product.createdAt.toISOString(),
  };
}
