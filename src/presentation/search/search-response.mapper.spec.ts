import { toSearchResponseDto } from './search-response.mapper';
import type { SearchOutcome } from '@application/models/search-outcome';
import type { SearchCriteria } from '@application/models/search-criteria';

const outcome = (total: number): SearchOutcome => ({
  items: [],
  total,
  facets: { categories: [], subcategories: [], locations: [], priceRanges: [] },
  suggestions: { didYouMean: null, related: [] },
});

const criteria = (page: number, pageSize: number): SearchCriteria => ({
  filters: {},
  sort: 'relevance',
  order: 'desc',
  page,
  pageSize,
});

describe('toSearchResponseDto', () => {
  it('computes totalPages as ceil(total / pageSize)', () => {
    expect(toSearchResponseDto(outcome(45), criteria(2, 20)).meta).toMatchObject({
      total: 45,
      page: 2,
      pageSize: 20,
      totalPages: 3,
    });
  });

  it('yields zero pages for an empty result set', () => {
    expect(toSearchResponseDto(outcome(0), criteria(1, 20)).meta.totalPages).toBe(0);
  });
});
