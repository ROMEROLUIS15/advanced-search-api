import { Logger } from '@nestjs/common';
import { FailoverRateLimitStore } from './failover-rate-limit.store';
import { InMemoryRateLimitStore } from './in-memory-rate-limit.store';
import type { RedisRateLimitStore } from './redis-rate-limit.store';

function buildRedis(hit: jest.Mock): RedisRateLimitStore {
  return { hit } as unknown as RedisRateLimitStore;
}

describe('FailoverRateLimitStore (design D14)', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('counts in Redis while it is reachable', async () => {
    // Arrange
    const redisHit = jest.fn().mockResolvedValue({ totalHits: 7, timeToExpireMs: 1_000 });
    const memory = new InMemoryRateLimitStore();
    const store = new FailoverRateLimitStore(buildRedis(redisHit), memory);

    // Act
    const hit = await store.hit('client-a', 60_000);

    // Assert
    expect(hit.totalHits).toBe(7);
    expect(redisHit).toHaveBeenCalledWith('client-a', 60_000);
  });

  it('KEEPS ENFORCING from memory when Redis fails — it does not fail open', async () => {
    // Arrange
    const redisHit = jest.fn().mockRejectedValue(new Error('connection refused'));
    const store = new FailoverRateLimitStore(buildRedis(redisHit), new InMemoryRateLimitStore());

    // Act
    const first = await store.hit('client-a', 60_000);
    const second = await store.hit('client-a', 60_000);
    const third = await store.hit('client-a', 60_000);

    // Assert — the count still climbs, so a budget can still be exceeded
    expect([first.totalHits, second.totalHits, third.totalHits]).toEqual([1, 2, 3]);
  });

  it('never throws when Redis fails, so a store outage cannot fail a request', async () => {
    // Arrange
    const redisHit = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const store = new FailoverRateLimitStore(buildRedis(redisHit), new InMemoryRateLimitStore());

    // Act & Assert
    await expect(store.hit('client-a', 60_000)).resolves.toEqual({
      totalHits: 1,
      timeToExpireMs: 60_000,
    });
  });

  it('logs the degradation once, not once per request', async () => {
    // Arrange
    const warn = jest.spyOn(Logger.prototype, 'warn');
    const redisHit = jest.fn().mockRejectedValue(new Error('down'));
    const store = new FailoverRateLimitStore(buildRedis(redisHit), new InMemoryRateLimitStore());

    // Act
    await store.hit('client-a', 60_000);
    await store.hit('client-a', 60_000);
    await store.hit('client-b', 60_000);

    // Assert
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('resumes shared counting, and says so, once Redis recovers', async () => {
    // Arrange
    const log = jest.spyOn(Logger.prototype, 'log');
    const redisHit = jest
      .fn()
      .mockRejectedValueOnce(new Error('down'))
      .mockResolvedValue({ totalHits: 12, timeToExpireMs: 5_000 });
    const store = new FailoverRateLimitStore(buildRedis(redisHit), new InMemoryRateLimitStore());

    // Act
    await store.hit('client-a', 60_000);
    const recovered = await store.hit('client-a', 60_000);

    // Assert
    expect(recovered.totalHits).toBe(12);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
