import { buildSearchRequest } from './search-query.builder';
import type { RelevanceConfig } from '@config/app-config';
import type { SearchCriteria } from '@application/models/search-criteria';

const relevance: RelevanceConfig = { popularityFactor: 1, recencyScale: '90d', recencyDecay: 0.5 };

const criteria = (overrides: Partial<SearchCriteria> = {}): SearchCriteria => ({
  query: undefined,
  filters: {},
  sort: 'relevance',
  order: 'desc',
  page: 1,
  pageSize: 20,
  ...overrides,
});

describe('buildSearchRequest', () => {
  it('uses match_all and omits post_filter in browse mode', () => {
    const req: any = buildSearchRequest({ criteria: criteria(), relevance, from: 0, size: 20 });
    expect(req.query.function_score.query).toEqual({ match_all: {} });
    expect(req.post_filter).toBeUndefined();
    expect(req).toMatchObject({ from: 0, size: 20, track_total_hits: true });
  });

  it('builds a fuzzy multi_match for a text query', () => {
    const req: any = buildSearchRequest({
      criteria: criteria({ query: 'drill' }),
      relevance,
      from: 0,
      size: 20,
    });
    expect(req.query.function_score.query.multi_match).toMatchObject({
      query: 'drill',
      fuzziness: 'AUTO',
      operator: 'or',
      minimum_should_match: '60%',
    });
  });

  it('moves facet filters into post_filter (design D4)', () => {
    const req: any = buildSearchRequest({
      criteria: criteria({ filters: { category: 'Tools' } }),
      relevance,
      from: 0,
      size: 20,
    });
    expect(req.post_filter).toEqual({
      bool: { filter: [{ term: { category: { value: 'Tools' } } }] },
    });
  });
});
