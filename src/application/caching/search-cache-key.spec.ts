import { buildSearchCacheKey } from './search-cache-key';
import type { SearchCriteria } from '@application/models/search-criteria';

const base: SearchCriteria = {
  query: 'drill',
  filters: { category: 'Tools', subcategories: ['a', 'b'] },
  sort: 'relevance',
  order: 'desc',
  page: 1,
  pageSize: 20,
};

describe('buildSearchCacheKey', () => {
  it('is namespaced and deterministic for equal criteria', () => {
    const key = buildSearchCacheKey(base);
    expect(key).toMatch(/^search:v1:[a-f0-9]{40}$/);
    expect(buildSearchCacheKey({ ...base })).toBe(key);
  });

  it('is independent of subcategory order', () => {
    const reordered: SearchCriteria = {
      ...base,
      filters: { ...base.filters, subcategories: ['b', 'a'] },
    };
    expect(buildSearchCacheKey(reordered)).toBe(buildSearchCacheKey(base));
  });

  it('differs when a relevant parameter changes', () => {
    expect(buildSearchCacheKey({ ...base, page: 2 })).not.toBe(buildSearchCacheKey(base));
  });
});
