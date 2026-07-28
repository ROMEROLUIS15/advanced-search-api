import type { Logger } from '@nestjs/common';
import type { ZodType } from 'zod';
import { errorMessage } from '@shared/error-message';
import type { CachePort } from '@application/ports/cache.port';
import type { MetricsPort } from '@application/ports/metrics.port';

export interface CacheAsideParams<T> {
  cache: CachePort;
  key: string;
  ttlSeconds: number;
  load: () => Promise<T>;
  logger: Logger;
  metrics: MetricsPort;
  /** A cached value that does not match is treated as a miss (design D27). */
  schema: ZodType<T>;
}

/**
 * In-flight loads, so N concurrent misses for one key make one upstream call
 * instead of N (design D26). Per process rather than per cluster on purpose: a
 * Redis lock would make the cache path need Redis to make progress, which is
 * exactly the coupling the fail-open design removed.
 */
const inFlight = new Map<string, Promise<unknown>>();

/** ±10 %, so entries written in the same burst do not expire in the same second. */
const JITTER = 0.1;

/**
 * Cache-aside with fail-open semantics (design D8): a cache hit is returned
 * as-is; on a miss `load()` runs and the result is cached best-effort. Any cache
 * error is logged and treated as a miss — it never fails the request. Errors from
 * `load()` propagate (they are the real operation, not the optimization).
 */
export async function cacheAside<T>(params: CacheAsideParams<T>): Promise<T> {
  const { cache, key, ttlSeconds, load, logger, metrics, schema } = params;

  // Zero is the explicit "cache disabled" value accepted by configuration. Do
  // not send `EX 0` to Redis: it rejects that expiry. Single-flight still keeps
  // simultaneous requests for the same key from stampeding Elasticsearch.
  if (ttlSeconds <= 0) {
    metrics.recordCacheMiss();
    return singleFlight(key, load);
  }

  const cached = await readThrough<T>(cache, key, logger, schema);
  if (cached !== null) {
    metrics.recordCacheHit();
    return cached;
  }
  // A cache *error* counts as a miss here too: what the counter answers is "how
  // often did we have to go to Elasticsearch", and a failed read did.
  metrics.recordCacheMiss();

  return singleFlight(key, async () => {
    const value = await load();
    await writeThrough(cache, key, value, ttlSeconds, logger);
    return value;
  });
}

/** Collapses concurrent loads of the same key onto the first one's promise. */
async function singleFlight<T>(key: string, load: () => Promise<T>): Promise<T> {
  const pending = inFlight.get(key);
  if (pending !== undefined) {
    return pending as Promise<T>;
  }

  const promise = load().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

async function readThrough<T>(
  cache: CachePort,
  key: string,
  logger: Logger,
  schema: ZodType<T>,
): Promise<T | null> {
  try {
    const raw = await cache.get<unknown>(key);
    if (raw === null) {
      return null;
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      // Stale shape from an older deploy, or a partially written value. Serving
      // it would hand a client something the contract does not describe.
      logger.warn(`Cache payload rejected (${key}): shape does not match`);
      return null;
    }
    return parsed.data;
  } catch (error) {
    logger.warn(`Cache read failed (${key}): ${errorMessage(error)}`);
    return null;
  }
}

async function writeThrough<T>(
  cache: CachePort,
  key: string,
  value: T,
  ttlSeconds: number,
  logger: Logger,
): Promise<void> {
  try {
    await cache.set(key, value, withJitter(ttlSeconds));
  } catch (error) {
    logger.warn(`Cache write failed (${key}): ${errorMessage(error)}`);
  }
}

/**
 * Spreads a TTL by ±10 %, floored at 1 s so rounding can never turn a positive
 * TTL into a non-positive one.
 *
 * Zero passes through unchanged, as the "cache disabled" marker `cacheAside`
 * checks before it ever reaches Redis. That guard is what matters: `SET … EX 0`
 * is not "no expiry", it is an error — measured, `ERR invalid expire time in
 * 'set' command` — so a zero arriving here would have been written and rejected
 * once per miss.
 */
export function withJitter(ttlSeconds: number): number {
  if (ttlSeconds <= 0) {
    return ttlSeconds;
  }
  const spread = 1 + (Math.random() * 2 - 1) * JITTER;
  return Math.max(1, Math.round(ttlSeconds * spread));
}
