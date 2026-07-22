import { AutocompleteUseCase } from './autocomplete.use-case';
import type { AutocompletePort } from '../ports/autocomplete.port';
import type { CachePort } from '../ports/cache.port';
import type { AutocompleteItem } from '../models/autocomplete-item';
import { buildConfig, type AppConfiguration } from '@config/app-config';
import { validateEnv } from '@config/env.schema';

const config: AppConfiguration = buildConfig(
  validateEnv({
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    REDIS_URL: 'redis://localhost:6379',
  }),
);

const items: AutocompleteItem[] = [{ text: 'Cordless Drill', score: 2 }];

function makeCache(overrides: Partial<CachePort> = {}): CachePort {
  return {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(undefined),
    del: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('AutocompleteUseCase', () => {
  it('returns cached completions on a hit without querying Elasticsearch', async () => {
    const cache = makeCache({ get: jest.fn().mockResolvedValue(items) });
    const port: AutocompletePort = { complete: jest.fn() };

    const result = await new AutocompleteUseCase(port, cache, config).execute('dri', 10);

    expect(result).toBe(items);
    expect(port.complete).not.toHaveBeenCalled();
  });

  it('queries Elasticsearch on a miss and caches the result', async () => {
    const cache = makeCache();
    const port: AutocompletePort = { complete: jest.fn().mockResolvedValue(items) };

    const result = await new AutocompleteUseCase(port, cache, config).execute('dri', 10);

    expect(result).toBe(items);
    expect(port.complete).toHaveBeenCalledWith('dri', 10);
    expect(cache.set).toHaveBeenCalledTimes(1);
  });
});
