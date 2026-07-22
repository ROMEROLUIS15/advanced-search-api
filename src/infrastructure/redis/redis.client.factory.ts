import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { AppConfiguration } from '@config/app-config';

/** DI token for the shared Redis client. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * Builds the Redis client. A `rediss://` URL enables TLS automatically (Upstash).
 * `enableOfflineQueue: false` makes commands fail fast while disconnected so the
 * cache-aside use-case degrades to Elasticsearch instead of hanging (fail-open).
 */
export function createRedisClient(config: AppConfiguration): Redis {
  const logger = new Logger('RedisClient');
  const client = new Redis(config.redis.url, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('error', (error: Error) => logger.warn(`Redis connection error: ${error.message}`));
  return client;
}
