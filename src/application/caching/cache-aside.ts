import type { Logger } from '@nestjs/common';
import { errorMessage } from '@shared/error-message';
import type { CachePort } from '@application/ports/cache.port';

export interface CacheAsideParams<T> {
  cache: CachePort;
  key: string;
  ttlSeconds: number;
  load: () => Promise<T>;
  logger: Logger;
}

/**
 * Cache-aside with fail-open semantics (design D8): a cache hit is returned
 * as-is; on a miss `load()` runs and the result is cached best-effort. Any cache
 * error is logged and treated as a miss — it never fails the request. Errors from
 * `load()` propagate (they are the real operation, not the optimization).
 */
export async function cacheAside<T>(params: CacheAsideParams<T>): Promise<T> {
  const { cache, key, ttlSeconds, load, logger } = params;

  const cached = await readThrough<T>(cache, key, logger);
  if (cached !== null) {
    return cached;
  }

  const value = await load();
  await writeThrough(cache, key, value, ttlSeconds, logger);
  return value;
}

async function readThrough<T>(cache: CachePort, key: string, logger: Logger): Promise<T | null> {
  try {
    return await cache.get<T>(key);
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
    await cache.set(key, value, ttlSeconds);
  } catch (error) {
    logger.warn(`Cache write failed (${key}): ${errorMessage(error)}`);
  }
}
