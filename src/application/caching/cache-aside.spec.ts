import { Logger } from '@nestjs/common';
import { cacheAside } from './cache-aside';
import type { CachePort } from '@application/ports/cache.port';

const logger = new Logger('test');

function makeCache(overrides: Partial<CachePort> = {}): CachePort {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('cacheAside', () => {
  it('returns the cached value without loading on a hit', async () => {
    const cache = makeCache({ get: jest.fn().mockResolvedValue('cached') });
    const load = jest.fn();

    const result = await cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger });

    expect(result).toBe('cached');
    expect(load).not.toHaveBeenCalled();
  });

  it('loads and writes through on a miss', async () => {
    const cache = makeCache();
    const load = jest.fn().mockResolvedValue('fresh');

    const result = await cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger });

    expect(result).toBe('fresh');
    expect(cache.set).toHaveBeenCalledWith('k', 'fresh', 60);
  });

  it('fails open when the cache read throws', async () => {
    const cache = makeCache({ get: jest.fn().mockRejectedValue(new Error('down')) });
    const load = jest.fn().mockResolvedValue('fresh');

    await expect(cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger })).resolves.toBe(
      'fresh',
    );
  });

  it('fails open when the cache write throws', async () => {
    const cache = makeCache({ set: jest.fn().mockRejectedValue(new Error('down')) });
    const load = jest.fn().mockResolvedValue('fresh');

    await expect(cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger })).resolves.toBe(
      'fresh',
    );
  });
});
