import type { SearchCriteria } from '../models/search-criteria';
import type { SearchOutcome } from '../models/search-outcome';

/** DI token — bind an infrastructure adapter with `{ provide: PRODUCT_SEARCH_PORT, useClass: ... }`. */
export const PRODUCT_SEARCH_PORT = Symbol('PRODUCT_SEARCH_PORT');

export interface ProductSearchPort {
  /** Single Elasticsearch round-trip returning hits, facets and suggestions. */
  search(criteria: SearchCriteria): Promise<SearchOutcome>;
}
