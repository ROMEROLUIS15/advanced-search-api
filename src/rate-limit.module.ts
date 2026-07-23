import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, type ThrottlerModuleOptions } from '@nestjs/throttler';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { RateLimitStoreModule } from '@infrastructure/rate-limit/rate-limit-store.module';
import { ThrottlerStoreAdapter } from '@presentation/rate-limit/throttler-store.adapter';
import { RateLimitGuard } from '@presentation/rate-limit/rate-limit.guard';
import { buildThrottlerOptions } from '@presentation/rate-limit/rate-limit.options';

/**
 * Registers request rate limiting globally (design D14–D19).
 *
 * The throttler is configured from `APP_CONFIG` and backed by our own storage —
 * Redis with an in-process fallback — rather than the library's default in-memory
 * store. Registering the guard through `APP_GUARD` applies it to every route; the
 * `/health` exemption and the enable switch live in the options `skipIf`, not in
 * per-controller decorators.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RateLimitStoreModule],
      inject: [APP_CONFIG, ThrottlerStoreAdapter],
      useFactory: (
        config: AppConfiguration,
        storage: ThrottlerStoreAdapter,
      ): ThrottlerModuleOptions => ({
        ...buildThrottlerOptions(config.rateLimit),
        storage,
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitModule {}
