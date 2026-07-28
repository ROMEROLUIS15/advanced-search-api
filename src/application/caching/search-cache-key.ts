import { createHash } from 'node:crypto';
import type { SearchCriteria } from '@application/models/search-criteria';

/** Namespace + version token; bump the version when the payload *shape* changes (design D8). */
const CACHE_NAMESPACE = 'search:v1';

/**
 * Deterministic cache key from normalized criteria, so equivalent requests share
 * a cache entry (e.g. subcategory order is irrelevant). Only deterministic,
 * non-personalized responses are cached.
 *
 * The `scope` segment carries the configuration the answer was computed under —
 * see {@link searchCacheScope}. It is what makes a reindex or a relevance change
 * miss instead of serving the previous deployment's results, so the version
 * token above no longer has to be bumped by hand for either.
 */
export function buildSearchCacheKey(criteria: SearchCriteria, scope: string): string {
  const hash = createHash('sha1')
    .update(JSON.stringify(normalize(criteria)))
    .digest('hex');
  return `${CACHE_NAMESPACE}:${scope}:${hash}`;
}

function normalize(criteria: SearchCriteria): Record<string, unknown> {
  return {
    q: criteria.query ?? '',
    category: criteria.filters.category ?? '',
    subcategories: [...(criteria.filters.subcategories ?? [])].sort(),
    location: criteria.filters.location ?? '',
    minPrice: criteria.filters.minPrice ?? null,
    maxPrice: criteria.filters.maxPrice ?? null,
    sort: criteria.sort,
    order: criteria.order,
    page: criteria.page,
    pageSize: criteria.pageSize,
  };
}
