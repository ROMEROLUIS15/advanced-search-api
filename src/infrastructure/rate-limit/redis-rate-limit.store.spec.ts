import { Redis } from 'ioredis';
import { RedisRateLimitStore } from './redis-rate-limit.store';

interface PipelineStub {
  incr: jest.Mock;
  pttl: jest.Mock;
  exec: jest.Mock;
}

function buildClient(replies: [Error | null, unknown][] | null): {
  client: Redis;
  pipeline: PipelineStub;
  pexpire: jest.Mock;
} {
  const pipeline: PipelineStub = {
    incr: jest.fn(),
    pttl: jest.fn(),
    exec: jest.fn().mockResolvedValue(replies),
  };
  pipeline.incr.mockReturnValue(pipeline);
  pipeline.pttl.mockReturnValue(pipeline);
  const pexpire = jest.fn().mockResolvedValue(1);
  const client = { multi: () => pipeline, pexpire } as unknown as Redis;
  return { client, pipeline, pexpire };
}

describe('RedisRateLimitStore', () => {
  it('increments and reports the remaining window in one round-trip', async () => {
    // Arrange
    const { client, pipeline } = buildClient([
      [null, 3],
      [null, 42_000],
    ]);
    const store = new RedisRateLimitStore(client);

    // Act
    const hit = await store.hit('client-a', 60_000);

    // Assert
    expect(hit).toEqual({ totalHits: 3, timeToExpireMs: 42_000 });
    expect(pipeline.incr).toHaveBeenCalledWith('ratelimit:v1:client-a');
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
  });

  it('opens the window when the key has no expiry yet', async () => {
    // Arrange
    const { client, pexpire } = buildClient([
      [null, 1],
      [null, -1],
    ]);
    const store = new RedisRateLimitStore(client);

    // Act
    const hit = await store.hit('client-a', 60_000);

    // Assert
    expect(pexpire).toHaveBeenCalledWith('ratelimit:v1:client-a', 60_000);
    expect(hit.timeToExpireMs).toBe(60_000);
  });

  it('re-opens the window if the key expired between the two commands', async () => {
    // Arrange
    const { client, pexpire } = buildClient([
      [null, 1],
      [null, -2],
    ]);
    const store = new RedisRateLimitStore(client);

    // Act
    const hit = await store.hit('client-a', 30_000);

    // Assert
    expect(pexpire).toHaveBeenCalledWith('ratelimit:v1:client-a', 30_000);
    expect(hit.timeToExpireMs).toBe(30_000);
  });

  it('propagates a command error so the caller can fail over', async () => {
    // Arrange
    const { client } = buildClient([
      [new Error('READONLY'), null],
      [null, 1_000],
    ]);
    const store = new RedisRateLimitStore(client);

    // Act & Assert
    await expect(store.hit('client-a', 60_000)).rejects.toThrow('READONLY');
  });

  it('propagates a dropped pipeline rather than inventing a count', async () => {
    // Arrange
    const { client } = buildClient(null);
    const store = new RedisRateLimitStore(client);

    // Act & Assert
    await expect(store.hit('client-a', 60_000)).rejects.toThrow(/no reply/);
  });
});
