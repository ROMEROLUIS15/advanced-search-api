import { createHash } from 'node:crypto';
import type { SearchCriteria } from '@application/models/search-criteria';

/** Namespace + version token; a reindex/alias flip should bump the version (design D8). */
const CACHE_NAMESPACE = 'search:v1';

/**
 * Deterministic cache key from normalized criteria, so equivalent requests share
 * a cache entry (e.g. subcategory order is irrelevant). Only deterministic,
 * non-personalized responses are cached.
 */
export function buildSearchCacheKey(criteria: SearchCriteria): string {
  const hash = createHash('sha1')
    .update(JSON.stringify(normalize(criteria)))
    .digest('hex');
  return `${CACHE_NAMESPACE}:${hash}`;
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
