import type { estypes } from '@elastic/elasticsearch';
import type { ProductSummary } from '@application/models/product-summary';
import type { ProductDocument } from '../index/product-document';

const DEFAULT_CURRENCY = 'USD';

/** Maps an Elasticsearch hit to a {@link ProductSummary} read model. */
export function toProductSummary(hit: estypes.SearchHit<ProductDocument>): ProductSummary {
  const source = hit._source;
  if (!source) {
    throw new Error(`Search hit ${hit._id ?? '(unknown)'} is missing _source`);
  }
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    category: source.category,
    subcategories: source.subcategories,
    location: source.location,
    price: source.price,
    currency: DEFAULT_CURRENCY,
    popularity: source.popularity,
    createdAt: source.createdAt,
    ...(hit._score != null ? { score: hit._score } : {}),
  };
}
