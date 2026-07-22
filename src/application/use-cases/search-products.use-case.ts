import { Inject, Injectable } from '@nestjs/common';
import type { SearchCriteria } from '../models/search-criteria';
import type { SearchOutcome } from '../models/search-outcome';
import { PRODUCT_SEARCH_PORT, type ProductSearchPort } from '../ports/product-search.port';

/**
 * Runs a product search. Depends only on the search port (no infrastructure).
 * Caching is layered on in group 9 without changing this contract.
 */
@Injectable()
export class SearchProductsUseCase {
  constructor(@Inject(PRODUCT_SEARCH_PORT) private readonly productSearch: ProductSearchPort) {}

  execute(criteria: SearchCriteria): Promise<SearchOutcome> {
    return this.productSearch.search(criteria);
  }
}
