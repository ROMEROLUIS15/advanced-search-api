import type { AppConfiguration } from '@config/app-config';
import { autocompleteCacheScope, searchCacheScope } from './cache-scope';

function configWith(
  index: string,
  relevance: Partial<AppConfiguration['relevance']> = {},
): AppConfiguration {
  return {
    elasticsearch: { index },
    relevance: { popularityFactor: 1, recencyScale: '90d', recencyDecay: 0.5, ...relevance },
  } as AppConfiguration;
}

describe('searchCacheScope', () => {
  it('is a short, stable token', () => {
    expect(searchCacheScope(configWith('products'))).toMatch(/^[a-f0-9]{8}$/);
    expect(searchCacheScope(configWith('products'))).toBe(searchCacheScope(configWith('products')));
  });

  it('changes with the index, so a reindex or alias flip cannot serve stale hits', () => {
    expect(searchCacheScope(configWith('products'))).not.toBe(
      searchCacheScope(configWith('products_2026')),
    );
  });

  it('changes with the relevance settings, which decide the order of the answer', () => {
    expect(searchCacheScope(configWith('products'))).not.toBe(
      searchCacheScope(configWith('products', { popularityFactor: 2 })),
    );
  });
});

describe('autocompleteCacheScope', () => {
  it('changes with the index', () => {
    expect(autocompleteCacheScope(configWith('products'))).not.toBe(
      autocompleteCacheScope(configWith('products_2026')),
    );
  });

  it('ignores relevance, which does not shape prefix matches', () => {
    // Arrange & Act & Assert: scoping these by ranking would discard the whole
    // prefix cache on a tune that cannot change a completion.
    expect(autocompleteCacheScope(configWith('products'))).toBe(
      autocompleteCacheScope(configWith('products', { recencyDecay: 0.9 })),
    );
  });

  it('is not the same token as the search scope for the same index', () => {
    expect(autocompleteCacheScope(configWith('products'))).not.toBe(
      searchCacheScope(configWith('products')),
    );
  });
});
