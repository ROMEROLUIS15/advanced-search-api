import { createHash } from 'node:crypto';

/** Namespace for autocomplete prefixes (design D8, `ac:*` family, short TTL). */
const CACHE_NAMESPACE = 'ac:v1';

/**
 * Deterministic key from the normalized prefix + limit, scoped to the index the
 * completions came from (see `autocompleteCacheScope`).
 *
 * The prefix is **hashed, not embedded**. It is whatever the user typed, and an
 * unhashed key writes every term anyone types into the Redis keyspace, where
 * `KEYS *` or a memory dump reads them back long after the request is gone.
 * Search keys already hashed their criteria; this one did not, which made the
 * type-ahead endpoint the more revealing of the two. `limit` stays readable: it
 * is a bounded integer the service chose, not user text.
 */
export function buildAutocompleteCacheKey(prefix: string, limit: number, scope: string): string {
  const hash = createHash('sha1').update(prefix.trim().toLowerCase()).digest('hex');
  return `${CACHE_NAMESPACE}:${scope}:${hash}:${limit}`;
}
