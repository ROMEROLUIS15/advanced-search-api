import type { estypes } from '@elastic/elasticsearch';
import type { SearchFilters } from '@application/models/search-criteria';

/**
 * Builds filter-context clauses for category / subcategory (any-of) / location /
 * price range. Reused for both the hits `post_filter` and the facet
 * sub-aggregations (design D4). Filters do not affect relevance scoring.
 */
export function buildFilterClauses(filters: SearchFilters): estypes.QueryDslQueryContainer[] {
  const clauses: estypes.QueryDslQueryContainer[] = [];

  if (filters.category) {
    clauses.push({ term: { category: { value: filters.category } } });
  }
  if (filters.subcategories && filters.subcategories.length > 0) {
    clauses.push({ terms: { subcategories: filters.subcategories } });
  }
  if (filters.location) {
    clauses.push({ term: { location: { value: filters.location } } });
  }

  const priceRange = buildPriceRange(filters.minPrice, filters.maxPrice);
  if (priceRange) {
    clauses.push(priceRange);
  }

  return clauses;
}

function buildPriceRange(
  min: number | undefined,
  max: number | undefined,
): estypes.QueryDslQueryContainer | undefined {
  if (min === undefined && max === undefined) {
    return undefined;
  }
  return {
    range: {
      price: {
        ...(min !== undefined ? { gte: min } : {}),
        ...(max !== undefined ? { lte: max } : {}),
      },
    },
  };
}
