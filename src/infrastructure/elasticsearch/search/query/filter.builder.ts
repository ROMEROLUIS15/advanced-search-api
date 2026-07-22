import type { estypes } from '@elastic/elasticsearch';
import type { SearchFilters } from '@application/models/search-criteria';

/** A facet dimension whose own filter is excluded when computing its own counts (design D4). */
export type FacetDimension = 'category' | 'subcategories' | 'location' | 'price';

/**
 * Builds filter-context clauses for category / subcategory (any-of) / location /
 * price range. Reused for the hits `post_filter` (no exclusion) and for each facet
 * sub-aggregation (excluding its own dimension so it can be widened — design D4).
 * Filters run in filter context and do not affect relevance scoring.
 */
export function buildFilterClauses(
  filters: SearchFilters,
  exclude?: FacetDimension,
): estypes.QueryDslQueryContainer[] {
  const clauses: estypes.QueryDslQueryContainer[] = [];

  if (exclude !== 'category' && filters.category) {
    clauses.push({ term: { category: { value: filters.category } } });
  }
  if (exclude !== 'subcategories' && filters.subcategories && filters.subcategories.length > 0) {
    clauses.push({ terms: { subcategories: filters.subcategories } });
  }
  if (exclude !== 'location' && filters.location) {
    clauses.push({ term: { location: { value: filters.location } } });
  }
  if (exclude !== 'price') {
    const priceRange = buildPriceRange(filters.minPrice, filters.maxPrice);
    if (priceRange) {
      clauses.push(priceRange);
    }
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
