/** Namespace for autocomplete prefixes (design D8, `ac:*` family, short TTL). */
const CACHE_NAMESPACE = 'ac:v1';

/** Deterministic key from the normalized prefix + limit. */
export function buildAutocompleteCacheKey(prefix: string, limit: number): string {
  return `${CACHE_NAMESPACE}:${prefix.trim().toLowerCase()}:${limit}`;
}
