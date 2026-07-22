import type { estypes } from '@elastic/elasticsearch';
import type { SearchFilters } from '@application/models/search-criteria';
import { buildFilterClauses, type FacetDimension } from './filter.builder';

const FACET_TERMS_SIZE = 50;

/** Configurable price buckets (design D4). `to` is exclusive, `from` inclusive. */
const PRICE_RANGES: estypes.AggregationsAggregationRange[] = [
  { to: 50 },
  { from: 50, to: 100 },
  { from: 100, to: 500 },
  { from: 500 },
];

/**
 * Facet aggregations (design D4). The aggregation universe is the text query
 * (filters live in `post_filter`, not the query), and each facet applies every
 * OTHER selected filter except its own dimension — so a narrowed dimension can
 * still be widened. This "exclude own dimension" rule is the highest-risk logic.
 */
export function buildFacetAggregations(
  filters: SearchFilters,
): Record<string, estypes.AggregationsAggregationContainer> {
  return {
    categories: termsFacet(filters, 'category'),
    subcategories: termsFacet(filters, 'subcategories'),
    locations: termsFacet(filters, 'location'),
    priceRanges: priceFacet(filters),
  };
}

function termsFacet(
  filters: SearchFilters,
  dimension: Extract<FacetDimension, 'category' | 'subcategories' | 'location'>,
): estypes.AggregationsAggregationContainer {
  return {
    filter: { bool: { filter: buildFilterClauses(filters, dimension) } },
    aggs: { values: { terms: { field: dimension, size: FACET_TERMS_SIZE } } },
  };
}

function priceFacet(filters: SearchFilters): estypes.AggregationsAggregationContainer {
  return {
    filter: { bool: { filter: buildFilterClauses(filters, 'price') } },
    aggs: { values: { range: { field: 'price', ranges: PRICE_RANGES } } },
  };
}
