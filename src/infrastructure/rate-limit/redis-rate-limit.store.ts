import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';
import type { RateLimitHit, RateLimitStorePort } from '@application/ports/rate-limit-store.port';
import { REDIS_CLIENT } from '../redis/redis.client.factory';

/** Namespaced and versioned like the cache keys, so a scheme change can retire them. */
const KEY_NAMESPACE = 'ratelimit:v1';

/**
 * Increment and set the window expiry in one atomic step. Doing it as separate
 * INCR / PTTL / PEXPIRE round-trips leaves a race: the expiry is only attached
 * after the first INCR, so an interleaved request can find the key with no TTL
 * or already gone and mis-count. A single script closes that window — the count
 * and its TTL always move together.
 */
const HIT_SCRIPT = `
  local hits = redis.call('INCR', KEYS[1])
  if hits == 1 then
    redis.call('PEXPIRE', KEYS[1], ARGV[1])
    return {hits, tonumber(ARGV[1])}
  end
  return {hits, redis.call('PTTL', KEYS[1])}
`;

/** ioredis attaches commands defined with `defineCommand` to the client at runtime. */
interface RedisWithHitCommand extends Redis {
  rateLimitHit(key: string, windowMs: number): Promise<[number, number]>;
}

/**
 * Redis-backed {@link RateLimitStorePort} (design D14): one shared counter, so a
 * limit is one limit across every instance.
 *
 * The script is registered once with `defineCommand`, which makes ioredis call
 * it through EVALSHA and fall back to EVAL only on NOSCRIPT — otherwise the
 * whole script body travels to Redis on every single request.
 *
 * Errors propagate — the fail-over decision belongs to
 * {@link FailoverRateLimitStore}, which is the only caller, keeping this adapter
 * a plain translation of the port onto Redis.
 */
@Injectable()
export class RedisRateLimitStore implements RateLimitStorePort {
  private readonly client: RedisWithHitCommand;

  constructor(@Inject(REDIS_CLIENT) client: Redis) {
    client.defineCommand('rateLimitHit', { numberOfKeys: 1, lua: HIT_SCRIPT });
    // The command exists only after the call above, which is why the cast is here
    // and not at the call site.
    this.client = client as RedisWithHitCommand;
  }

  async hit(key: string, windowMs: number): Promise<RateLimitHit> {
    const namespaced = `${KEY_NAMESPACE}:${key}`;
    const [totalHits, timeToExpireMs] = await this.client.rateLimitHit(namespaced, windowMs);

    return { totalHits: Number(totalHits), timeToExpireMs: Number(timeToExpireMs) };
  }
}
