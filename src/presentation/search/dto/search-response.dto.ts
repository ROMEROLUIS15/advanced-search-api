import type { Facets } from '@application/models/facets';
import type { ProductSummary } from '@application/models/product-summary';
import type { SearchSuggestions } from '@application/models/query-suggestion';
import type { SortField, SortOrder } from '@application/models/search-criteria';

export interface SearchMetaDto {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: SortField;
  order: SortOrder;
}

/** Response envelope for `GET /search`. Built by a mapper — never a domain entity. */
export interface SearchResponseDto {
  data: ProductSummary[];
  meta: SearchMetaDto;
  facets: Facets;
  suggestions: SearchSuggestions;
}
