export type SortField = 'relevance' | 'popularity' | 'created_at';
export type SortOrder = 'asc' | 'desc';

export interface SearchFilters {
  category?: string;
  /** ANY-of match across the provided subcategories. */
  subcategories?: string[];
  location?: string;
  minPrice?: number;
  maxPrice?: number;
}

/**
 * Normalized, validated search input consumed by the search port. Decoupled from
 * the HTTP DTO so the transport can change without touching the domain/adapters.
 */
export interface SearchCriteria {
  /** Free-text query; omitted/empty ⇒ browse mode (match all). */
  query?: string;
  filters: SearchFilters;
  sort: SortField;
  order: SortOrder;
  /** 1-based page number. */
  page: number;
  pageSize: number;
}
