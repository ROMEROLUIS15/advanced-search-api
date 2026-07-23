import { Inject, Injectable } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface';
import {
  RATE_LIMIT_STORE,
  type RateLimitStorePort,
} from '@application/ports/rate-limit-store.port';

/**
 * Bridges `@nestjs/throttler`'s storage contract onto {@link RateLimitStorePort}
 * (design D15), so the counting substrate stays ours — Redis with an in-process
 * fallback — while the guard semantics come from the official package.
 *
 * Unit conventions are the library's, and they differ on either side of the call:
 * `ttl` and `blockDuration` arrive in **milliseconds**, while `timeToExpire` and
 * `timeToBlockExpire` are reported back in **seconds**.
 */
@Injectable()
export class ThrottlerStoreAdapter implements ThrottlerStorage {
  constructor(@Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStorePort) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    _blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    const { totalHits, timeToExpireMs } = await this.store.hit(`${throttlerName}:${key}`, ttl);
    const timeToExpire = Math.max(0, Math.ceil(timeToExpireMs / 1000));

    // The request that takes the count past the budget is the first one refused,
    // so a limit of 60 serves 60 and rejects the 61st. There is no separate block
    // period: a client is refused until its window resets, and `Retry-After`
    // therefore reports exactly that remainder.
    return {
      totalHits,
      timeToExpire,
      isBlocked: totalHits > limit,
      timeToBlockExpire: timeToExpire,
    };
  }
}
