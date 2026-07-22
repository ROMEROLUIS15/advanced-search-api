export const CACHE_PORT = Symbol('CACHE_PORT');

/**
 * Generic cache abstraction. Used cache-aside and fail-open at the use-case
 * boundary: callers treat any error as a miss, never a failure (design D8).
 */
export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}
