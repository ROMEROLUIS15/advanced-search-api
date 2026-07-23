import { Module } from '@nestjs/common';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { RATE_LIMIT_STORE } from '@application/ports/rate-limit-store.port';
import { ThrottlerStoreAdapter } from '@presentation/rate-limit/throttler-store.adapter';
import { InMemoryRateLimitStore } from './in-memory-rate-limit.store';
import { RedisRateLimitStore } from './redis-rate-limit.store';
import { FailoverRateLimitStore } from './failover-rate-limit.store';

/**
 * Wires the counter store chain (design D14) and the throttler bridge, exporting
 * only the adapter the guard consumes. `RATE_LIMIT_STORE` is bound to the
 * fail-over store, so the rest of the app sees one port and never the two
 * concrete stores behind it.
 */
@Module({
  imports: [RedisModule],
  providers: [
    InMemoryRateLimitStore,
    RedisRateLimitStore,
    FailoverRateLimitStore,
    { provide: RATE_LIMIT_STORE, useExisting: FailoverRateLimitStore },
    ThrottlerStoreAdapter,
  ],
  exports: [ThrottlerStoreAdapter],
})
export class RateLimitStoreModule {}
