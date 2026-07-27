import { Redis } from 'ioredis';
import { RedisRateLimitStore } from './redis-rate-limit.store';

/**
 * Stands in for ioredis: `defineCommand` attaches the command to the client, so
 * the double does the same rather than pretending the method was always there.
 */
function buildClient(hit: jest.Mock): { client: Redis; defineCommand: jest.Mock } {
  const client: Record<string, unknown> = {};
  const defineCommand = jest.fn((name: string) => {
    client[name] = hit;
  });
  client.defineCommand = defineCommand;
  return { client: client as unknown as Redis, defineCommand };
}

describe('RedisRateLimitStore', () => {
  it('registers the script once so ioredis can run it through EVALSHA', () => {
    // Arrange
    const { client, defineCommand } = buildClient(jest.fn());

    // Act
    new RedisRateLimitStore(client);

    // Assert: shipping the whole script body on every request is what this avoids.
    expect(defineCommand).toHaveBeenCalledTimes(1);
    const [name, options] = defineCommand.mock.calls[0];
    expect(name).toBe('rateLimitHit');
    expect(options).toMatchObject({ numberOfKeys: 1, lua: expect.stringContaining('INCR') });
  });

  it('runs one atomic call and returns the count with the remaining window', async () => {
    // Arrange
    const hit = jest.fn().mockResolvedValue([3, 42_000]);
    const store = new RedisRateLimitStore(buildClient(hit).client);

    // Act
    const result = await store.hit('client-a', 60_000);

    // Assert
    expect(result).toEqual({ totalHits: 3, timeToExpireMs: 42_000 });
    expect(hit).toHaveBeenCalledTimes(1);
  });

  it('namespaces and versions the key and passes the window through', async () => {
    // Arrange
    const hit = jest.fn().mockResolvedValue([1, 60_000]);
    const store = new RedisRateLimitStore(buildClient(hit).client);

    // Act
    await store.hit('client-a', 60_000);

    // Assert
    expect(hit).toHaveBeenCalledWith('ratelimit:v1:client-a', 60_000);
  });

  it('coerces the script reply to numbers', async () => {
    // Arrange — Redis may hand back numeric strings
    const hit = jest.fn().mockResolvedValue(['5', '30000']);
    const store = new RedisRateLimitStore(buildClient(hit).client);

    // Act
    const result = await store.hit('client-a', 60_000);

    // Assert
    expect(result).toEqual({ totalHits: 5, timeToExpireMs: 30_000 });
  });

  it('propagates a Redis error so the caller can fail over', async () => {
    // Arrange
    const hit = jest.fn().mockRejectedValue(new Error('READONLY'));
    const store = new RedisRateLimitStore(buildClient(hit).client);

    // Act & Assert
    await expect(store.hit('client-a', 60_000)).rejects.toThrow('READONLY');
  });
});
