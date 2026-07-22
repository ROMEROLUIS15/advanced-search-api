import { Redis } from 'ioredis';
import { RedisCacheAdapter } from './redis-cache.adapter';

interface MockRedis {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
}

function adapterWith(client: MockRedis): RedisCacheAdapter {
  return new RedisCacheAdapter(client as unknown as Redis);
}

describe('RedisCacheAdapter', () => {
  it('parses a JSON value on hit', async () => {
    const client: MockRedis = {
      get: jest.fn().mockResolvedValue(JSON.stringify({ total: 3 })),
      set: jest.fn(),
      del: jest.fn(),
    };

    await expect(adapterWith(client).get<{ total: number }>('k')).resolves.toEqual({ total: 3 });
  });

  it('returns null on a miss', async () => {
    const client: MockRedis = {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
      del: jest.fn(),
    };
    await expect(adapterWith(client).get('k')).resolves.toBeNull();
  });

  it('serializes the value with a TTL on set', async () => {
    const client: MockRedis = {
      get: jest.fn(),
      set: jest.fn().mockResolvedValue('OK'),
      del: jest.fn(),
    };

    await adapterWith(client).set('k', { total: 3 }, 300);

    expect(client.set).toHaveBeenCalledWith('k', JSON.stringify({ total: 3 }), 'EX', 300);
  });
});
