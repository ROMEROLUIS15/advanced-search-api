import type { estypes } from '@elastic/elasticsearch';
import type { SortField, SortOrder } from '@application/models/search-criteria';

/**
 * Sort with a deterministic tiebreaker so pagination is stable — no duplicated or
 * skipped documents across pages (design D5). Non-relevance sorts fall back to
 * `_score` then `id`; relevance sorts fall back to `id`.
 */
export function buildSort(sort: SortField, order: SortOrder): estypes.Sort {
  const tieBreaker: estypes.SortCombinations[] = [
    { _score: { order: 'desc' } },
    { id: { order: 'asc' } },
  ];

  switch (sort) {
    case 'popularity':
      return [{ popularity: { order } }, ...tieBreaker];
    case 'created_at':
      return [{ createdAt: { order } }, ...tieBreaker];
    case 'relevance':
    default:
      return [{ _score: { order } }, { id: { order: 'asc' } }];
  }
}
