import type { SearchCriteria } from '@application/models/search-criteria';
import type { SearchOutcome } from '@application/models/search-outcome';
import type { SearchResponseDto } from './dto/search-response.dto';

/** Builds the `GET /search` response envelope with derived pagination metadata. */
export function toSearchResponseDto(
  outcome: SearchOutcome,
  criteria: SearchCriteria,
): SearchResponseDto {
  const totalPages = criteria.pageSize > 0 ? Math.ceil(outcome.total / criteria.pageSize) : 0;

  return {
    data: outcome.items,
    meta: {
      total: outcome.total,
      page: criteria.page,
      pageSize: criteria.pageSize,
      totalPages,
      sort: criteria.sort,
      order: criteria.order,
    },
    facets: outcome.facets,
    suggestions: outcome.suggestions,
  };
}
