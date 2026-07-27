import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ApiKeyGuard } from '@presentation/auth/api-key.guard';

/**
 * Registers API key authentication globally (design D30–D34).
 *
 * **Imported after `RateLimitModule` on purpose.** Nest runs global guards in
 * the order their providers are registered, and the rate limiter must go first:
 * otherwise an unauthenticated flood would be rejected without ever touching a
 * budget, which is a free way to keep the process busy. Counting first means a
 * caller guessing keys runs out of budget like anyone else.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }],
})
export class ApiAuthModule {}
