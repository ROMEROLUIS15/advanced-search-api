import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { CachePort } from '@application/ports/cache.port';
import { REDIS_CLIENT } from './redis.client.factory';

/**
 * Redis-backed {@link CachePort}. Errors propagate to the caller, which treats
 * them as a miss (fail-open lives at the use-case boundary, design D8).
 */
@Injectable()
export class RedisCacheAdapter implements CachePort {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(key);
    if (raw === null) {
      return null;
    }
    return JSON.parse(raw) as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }
}
