import { Injectable, Logger } from '@nestjs/common';
import { errorMessage } from '@shared/error-message';
import type { RateLimitHit, RateLimitStorePort } from '@application/ports/rate-limit-store.port';
import { InMemoryRateLimitStore } from './in-memory-rate-limit.store';
import { RedisRateLimitStore } from './redis-rate-limit.store';

/**
 * The fail-over composition at the heart of design D14.
 *
 * Counting happens in Redis so a limit is shared across instances. When Redis is
 * unreachable this does NOT fall back to letting traffic through: it falls over
 * to an in-process counter and keeps enforcing.
 *
 * That choice is deliberate. The same Redis backs the search cache, so an outage
 * removes the cache and would remove the limiter at the same moment — every
 * request would reach Elasticsearch exactly when nothing is throttling them.
 * Failing closed was equally unacceptable: it would turn a dependency the
 * service treats as non-critical (`/health` stays 200 when Redis is down) into
 * one that can take the API offline.
 */
@Injectable()
export class FailoverRateLimitStore implements RateLimitStorePort {
  private readonly logger = new Logger(FailoverRateLimitStore.name);
  private degraded = false;

  constructor(
    private readonly redis: RedisRateLimitStore,
    private readonly memory: InMemoryRateLimitStore,
  ) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    try {
      const result = await this.redis.hit(key, windowMs);
      this.recover();
      return result;
    } catch (error) {
      this.reportDegraded(error);
      return this.memory.hit(key, windowMs);
    }
  }

  /** Logged on the transition only: a Redis outage would otherwise log per request. */
  private reportDegraded(error: unknown): void {
    if (!this.degraded) {
      this.degraded = true;
      this.logger.warn(
        `Rate limit counter falling back to memory, limits are now per instance: ${errorMessage(error)}`,
      );
    }
  }

  private recover(): void {
    if (this.degraded) {
      this.degraded = false;
      this.logger.log('Rate limit counter is served by Redis again, limits are shared');
    }
  }
}
