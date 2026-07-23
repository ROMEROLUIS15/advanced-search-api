import { Redis } from 'ioredis';
import { RedisRateLimitStore } from './redis-rate-limit.store';

function buildClient(eval_: jest.Mock): Redis {
  return { eval: eval_ } as unknown as Redis;
}

describe('RedisRateLimitStore', () => {
  it('runs one atomic script and returns the count with the remaining window', async () => {
    // Arrange
    const evalMock = jest.fn().mockResolvedValue([3, 42_000]);
    const store = new RedisRateLimitStore(buildClient(evalMock));

    // Act
    const hit = await store.hit('client-a', 60_000);

    // Assert
    expect(hit).toEqual({ totalHits: 3, timeToExpireMs: 42_000 });
    expect(evalMock).toHaveBeenCalledTimes(1);
  });

  it('namespaces and versions the key and passes the window to the script', async () => {
    // Arrange
    const evalMock = jest.fn().mockResolvedValue([1, 60_000]);
    const store = new RedisRateLimitStore(buildClient(evalMock));

    // Act
    await store.hit('client-a', 60_000);

    // Assert — eval(script, numKeys, key, windowMs)
    const [, numKeys, key, windowMs] = evalMock.mock.calls[0];
    expect(numKeys).toBe(1);
    expect(key).toBe('ratelimit:v1:client-a');
    expect(windowMs).toBe(60_000);
  });

  it('coerces the script reply to numbers', async () => {
    // Arrange — Redis may hand back numeric strings
    const evalMock = jest.fn().mockResolvedValue(['5', '30000']);
    const store = new RedisRateLimitStore(buildClient(evalMock));

    // Act
    const hit = await store.hit('client-a', 60_000);

    // Assert
    expect(hit.totalHits).toBe(5);
    expect(hit.timeToExpireMs).toBe(30_000);
  });

  it('propagates a Redis error so the caller can fail over', async () => {
    // Arrange
    const evalMock = jest.fn().mockRejectedValue(new Error('READONLY'));
    const store = new RedisRateLimitStore(buildClient(evalMock));

    // Act & Assert
    await expect(store.hit('client-a', 60_000)).rejects.toThrow('READONLY');
  });
});
