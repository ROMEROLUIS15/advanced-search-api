import type { SearchConfig } from '@config/app-config';
import type { SearchCriteria } from '@application/models/search-criteria';
import type { SearchQueryDto } from './dto/search-query.dto';

/**
 * Maps validated HTTP query params to normalized search criteria, applying
 * defaults: relevance sort with a query, popularity in browse mode (design D11).
 */
export function toSearchCriteria(dto: SearchQueryDto, config: SearchConfig): SearchCriteria {
  const query = dto.q?.trim() ? dto.q.trim() : undefined;

  return {
    query,
    filters: {
      category: dto.category,
      subcategories: dto.subcategory,
      location: dto.location,
      minPrice: dto.minPrice,
      maxPrice: dto.maxPrice,
    },
    sort: dto.sort ?? (query ? 'relevance' : 'popularity'),
    order: dto.order ?? 'desc',
    page: dto.page ?? 1,
    pageSize: dto.pageSize ?? config.defaultPageSize,
  };
}
