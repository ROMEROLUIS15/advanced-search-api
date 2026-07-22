import { Module } from '@nestjs/common';
import { Redis } from 'ioredis';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { CACHE_PORT } from '@application/ports/cache.port';
import { REDIS_CLIENT, createRedisClient } from './redis.client.factory';
import { RedisClientLifecycle } from './redis-client.lifecycle';
import { RedisCacheAdapter } from './redis-cache.adapter';

/** Infrastructure module wiring the Redis client and the cache adapter. */
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: (config: AppConfiguration): Redis => createRedisClient(config),
      inject: [APP_CONFIG],
    },
    RedisClientLifecycle,
    { provide: CACHE_PORT, useClass: RedisCacheAdapter },
  ],
  exports: [CACHE_PORT],
})
export class RedisModule {}
