import { Logger } from '@nestjs/common';
import { cacheAside, withJitter } from './cache-aside';
import type { CachePort } from '@application/ports/cache.port';
import type { MetricsPort } from '@application/ports/metrics.port';
import { z } from 'zod';

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

    const result = await cacheAside({
      cache,
      key: 'k',
      ttlSeconds: 60,
      load,
      logger,
      metrics,
      schema: z.string(),
    });

    expect(result).toBe('cached');
    expect(load).not.toHaveBeenCalled();
  });

  it('loads and writes through on a miss', async () => {
    const cache = makeCache();
    const load = jest.fn().mockResolvedValue('fresh');

    const result = await cacheAside({
      cache,
      key: 'k',
      ttlSeconds: 60,
      load,
      logger,
      metrics,
      schema: z.string(),
    });

    expect(result).toBe('fresh');
    // The TTL carries ±10 % jitter (design D26), so the exact second is not the contract.
    expect(cache.set).toHaveBeenCalledWith('k', 'fresh', expect.any(Number));
  });

  it('fails open when the cache read throws', async () => {
    const cache = makeCache({ get: jest.fn().mockRejectedValue(new Error('down')) });
    const load = jest.fn().mockResolvedValue('fresh');

    await expect(
      cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger, metrics, schema: z.string() }),
    ).resolves.toBe('fresh');
  });

  it('fails open when the cache write throws', async () => {
    const cache = makeCache({ set: jest.fn().mockRejectedValue(new Error('down')) });
    const load = jest.fn().mockResolvedValue('fresh');

    await expect(
      cacheAside({ cache, key: 'k', ttlSeconds: 60, load, logger, metrics, schema: z.string() }),
    ).resolves.toBe('fresh');
  });

  it('bypasses Redis when a zero TTL disables caching', async () => {
    const cache = makeCache();
    const load = jest.fn().mockResolvedValue('fresh');

    await expect(
      cacheAside({ cache, key: 'k', ttlSeconds: 0, load, logger, metrics, schema: z.string() }),
    ).resolves.toBe('fresh');

    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
    expect(metrics.recordCacheMiss).toHaveBeenCalledTimes(1);
  });
});

describe('cacheAside — metrics (design D24)', () => {
  it('counts a hit when the value came from cache', async () => {
    const cache = makeCache({ get: jest.fn().mockResolvedValue('cached') });

    await cacheAside({
      cache,
      key: 'k',
      ttlSeconds: 60,
      load: jest.fn(),
      logger,
      metrics,
      schema: z.string(),
    });

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
      schema: z.string(),
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
      schema: z.string(),
    });

    expect(metrics.recordCacheMiss).toHaveBeenCalledTimes(1);
  });
});

describe('cacheAside — stampede and payload safety (D26, D27)', () => {
  it('collapses concurrent misses for one key into a single load', async () => {
    // Arrange
    const cache = makeCache();
    let resolveLoad: (value: string) => void = () => undefined;
    const load = jest.fn().mockReturnValue(
      new Promise<string>((resolve) => {
        resolveLoad = resolve;
      }),
    );

    // Act: ten callers miss at the same moment, as they would on a hot query.
    const calls = Array.from({ length: 10 }, () =>
      cacheAside({ cache, key: 'hot', ttlSeconds: 60, load, logger, metrics, schema: z.string() }),
    );
    resolveLoad('fresh');
    const results = await Promise.all(calls);

    // Assert
    expect(load).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array.from({ length: 10 }, () => 'fresh'));
  });

  it('starts a new load once the previous one has settled', async () => {
    // Arrange
    const cache = makeCache();
    const load = jest.fn().mockResolvedValue('fresh');

    // Act
    await cacheAside({
      cache,
      key: 'k',
      ttlSeconds: 60,
      load,
      logger,
      metrics,
      schema: z.string(),
    });
    await cacheAside({
      cache,
      key: 'k',
      ttlSeconds: 60,
      load,
      logger,
      metrics,
      schema: z.string(),
    });

    // Assert: the in-flight entry must not leak past settlement.
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('treats a payload of the wrong shape as a miss instead of serving it', async () => {
    // Arrange: what an older deploy's entry looks like after a shape change.
    const cache = makeCache({ get: jest.fn().mockResolvedValue({ unexpected: true }) });
    const load = jest.fn().mockResolvedValue('fresh');
    const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);

    // Act
    const result = await cacheAside({
      cache,
      key: 'k',
      ttlSeconds: 60,
      load,
      logger,
      metrics,
      schema: z.string(),
    });

    // Assert
    expect(result).toBe('fresh');
    expect(load).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('shape does not match'));
    warn.mockRestore();
  });

  it('spreads the TTL within ±10 % so entries do not expire in lockstep', () => {
    // Arrange & Act
    const values = Array.from({ length: 200 }, () => withJitter(300));

    // Assert
    expect(Math.min(...values)).toBeGreaterThanOrEqual(270);
    expect(Math.max(...values)).toBeLessThanOrEqual(330);
    expect(new Set(values).size).toBeGreaterThan(1);
  });

  it('keeps positive TTLs valid and preserves zero as the disabled-cache marker', () => {
    // Arrange & Act & Assert
    expect(withJitter(1)).toBeGreaterThanOrEqual(1);
    expect(withJitter(0)).toBe(0);
  });
});
