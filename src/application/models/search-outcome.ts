import type { Facets } from './facets';
import type { ProductSummary } from './product-summary';
import type { SearchSuggestions } from './query-suggestion';

/**
 * Result of a single search round-trip: hits + total + facets + suggestions.
 * Pagination metadata (page/pageSize/totalPages) is derived by callers from the
 * criteria and `total`.
 */
export interface SearchOutcome {
  items: ProductSummary[];
  total: number;
  facets: Facets;
  suggestions: SearchSuggestions;
}
