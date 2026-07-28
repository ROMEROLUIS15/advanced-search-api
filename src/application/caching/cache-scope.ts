import { createHash } from 'node:crypto';
import type { AppConfiguration } from '@config/app-config';

/**
 * Identifies *what a cached answer was computed from*, so entries produced under
 * one configuration are never served under another (design D8).
 *
 * Without it a key describes only the question, never the data: two deployments
 * pointed at the same Redis but different indices share every entry, and a
 * relevance change keeps serving the old ranking until each key expires. Both
 * are silent — the payload validates, so nothing rejects it.
 *
 * **What this does not separate**: two deployments with the same index name, the
 * same relevance settings and the same Redis. Telling those apart needs a
 * deployment identifier, which this service does not have; the honest fix there
 * is separate Redis databases, not a longer key.
 *
 * Eight hex characters: collisions here mean two *configurations* colliding, not
 * two queries, and there are a handful of configurations in a service's life.
 */
const SCOPE_LENGTH = 8;

/** Search results depend on the index they came from and on how they were ranked. */
export function searchCacheScope(config: AppConfiguration): string {
  return digest({
    index: config.elasticsearch.index,
    relevance: config.relevance,
  });
}

/**
 * Completions depend on the index alone: they are prefix matches over names, so
 * the relevance weights that order search hits do not shape them. Scoping them
 * by relevance too would throw the whole prefix cache away on an unrelated tune.
 */
export function autocompleteCacheScope(config: AppConfiguration): string {
  return digest({ index: config.elasticsearch.index });
}

function digest(parts: Record<string, unknown>): string {
  return createHash('sha1').update(JSON.stringify(parts)).digest('hex').slice(0, SCOPE_LENGTH);
}
