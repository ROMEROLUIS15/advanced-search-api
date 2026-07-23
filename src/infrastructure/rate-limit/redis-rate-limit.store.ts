import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { RateLimitHit, RateLimitStorePort } from '@application/ports/rate-limit-store.port';
import { REDIS_CLIENT } from '../redis/redis.client.factory';

/** Namespaced and versioned like the cache keys, so a scheme change can retire them. */
const KEY_NAMESPACE = 'ratelimit:v1';

/**
 * Redis-backed {@link RateLimitStorePort} (design D14): one shared counter, so a
 * limit is one limit across every instance.
 *
 * Errors propagate — the fail-over decision belongs to
 * {@link FailoverRateLimitStore}, which is the only caller, keeping this adapter
 * a plain translation of the port onto Redis.
 */
@Injectable()
export class RedisRateLimitStore implements RateLimitStorePort {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {}

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const namespaced = `${KEY_NAMESPACE}:${key}`;

    // One round-trip: increment, then ask how much of the window is left.
    const replies = await this.client.multi().incr(namespaced).pttl(namespaced).exec();
    const totalHits = readNumber(replies, 0);
    let timeToExpireMs = readNumber(replies, 1);

    // PTTL reports -1 with no expiry set and -2 if the key vanished between the
    // two commands; either way this hit opens the window.
    if (timeToExpireMs < 0) {
      await this.client.pexpire(namespaced, windowMs);
      timeToExpireMs = windowMs;
    }

    return { totalHits, timeToExpireMs };
  }
}

/** Reads one reply out of an ioredis pipeline result, failing loudly on a command error. */
function readNumber(replies: [Error | null, unknown][] | null, index: number): number {
  const reply = replies?.[index];
  if (!reply) {
    throw new Error('Redis pipeline returned no reply for the rate limit counter');
  }
  const [error, value] = reply;
  if (error) {
    throw error;
  }
  return Number(value);
}
