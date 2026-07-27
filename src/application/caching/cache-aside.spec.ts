import { Logger } from '@nestjs/common';
import { cacheAside } from './cache-aside';
import type { CachePort } from '@application/ports/cache.port';
import type { MetricsPort } from '@application/ports/metrics.port';

const logger = new Logger('test');

function makeMetrics(): jest.Mocked<MetricsPort> {
  return {
    observeRequest: jest.fn(),
    recordCacheHit: jest.fn(),
    recordCacheMiss: jest.fn(),
    recordRateLimitFailover: jest.fn(),
  };
}

let metrics = makeMetrics();
beforeEach(() => {
  metrics = makeMetrics();
});

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

    const result = await cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger, metrics });

    expect(result).toBe('cached');
    expect(load).not.toHaveBeenCalled();
  });

  it('loads and writes through on a miss', async () => {
    const cache = makeCache();
    const load = jest.fn().mockResolvedValue('fresh');

    const result = await cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger, metrics });

    expect(result).toBe('fresh');
    expect(cache.set).toHaveBeenCalledWith('k', 'fresh', 60);
  });

  it('fails open when the cache read throws', async () => {
    const cache = makeCache({ get: jest.fn().mockRejectedValue(new Error('down')) });
    const load = jest.fn().mockResolvedValue('fresh');

    await expect(
      cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger, metrics }),
    ).resolves.toBe('fresh');
  });

  it('fails open when the cache write throws', async () => {
    const cache = makeCache({ set: jest.fn().mockRejectedValue(new Error('down')) });
    const load = jest.fn().mockResolvedValue('fresh');

    await expect(
      cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger, metrics }),
    ).resolves.toBe('fresh');
  });
});

describe('cacheAside — metrics (design D24)', () => {
  it('counts a hit when the value came from cache', async () => {
    const cache = makeCache({ get: jest.fn().mockResolvedValue('cached') });

    await cacheAside({ cache, key: 'k', ttlSeconds: 60, load: jest.fn(), logger, metrics });

    expect(metrics.recordCacheHit).toHaveBeenCalledTimes(1);
    expect(metrics.recordCacheMiss).not.toHaveBeenCalled();
  });

  it('counts a miss when Elasticsearch had to answer', async () => {
    const cache = makeCache();

    await cacheAside({
      cache,
      key: 'k',
      ttlSeconds: 60,
      load: jest.fn().mockResolvedValue('fresh'),
      logger,
      metrics,
    });

    expect(metrics.recordCacheMiss).toHaveBeenCalledTimes(1);
    expect(metrics.recordCacheHit).not.toHaveBeenCalled();
  });

  it('counts a cache error as a miss, because the load still happened', async () => {
    const cache = makeCache({ get: jest.fn().mockRejectedValue(new Error('down')) });

    await cacheAside({
      cache,
      key: 'k',
      ttlSeconds: 60,
      load: jest.fn().mockResolvedValue('fresh'),
      logger,
      metrics,
    });

    expect(metrics.recordCacheMiss).toHaveBeenCalledTimes(1);
  });
});
