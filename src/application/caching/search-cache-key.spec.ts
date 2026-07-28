import { buildSearchCacheKey } from './search-cache-key';
import type { SearchCriteria } from '@application/models/search-criteria';

const SCOPE = 'a1b2c3d4';

const base: SearchCriteria = {
  query: 'drill',
  filters: { category: 'Tools', subcategories: ['a', 'b'] },
  sort: 'relevance',
  order: 'desc',
  page: 1,
  pageSize: 20,
};

describe('buildSearchCacheKey', () => {
  it('is namespaced, scoped and deterministic for equal criteria', () => {
    const key = buildSearchCacheKey(base, SCOPE);
    expect(key).toMatch(/^search:v1:a1b2c3d4:[a-f0-9]{40}$/);
    expect(buildSearchCacheKey({ ...base }, SCOPE)).toBe(key);
  });

  it('is independent of subcategory order', () => {
    const reordered: SearchCriteria = {
      ...base,
      filters: { ...base.filters, subcategories: ['b', 'a'] },
    };
    expect(buildSearchCacheKey(reordered, SCOPE)).toBe(buildSearchCacheKey(base, SCOPE));
  });

  it('differs when a relevant parameter changes', () => {
    expect(buildSearchCacheKey({ ...base, page: 2 }, SCOPE)).not.toBe(
      buildSearchCacheKey(base, SCOPE),
    );
  });

  it('differs by scope, so another index or ranking cannot serve these hits', () => {
    expect(buildSearchCacheKey(base, SCOPE)).not.toBe(buildSearchCacheKey(base, 'ffffffff'));
  });

  it('never writes the query text into the key', () => {
    expect(buildSearchCacheKey(base, SCOPE)).not.toContain('drill');
  });
});
