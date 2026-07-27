// The DTO's decorators run on import; without this they have no metadata API.
import 'reflect-metadata';
import type { SearchConfig } from '@config/app-config';
import { SearchQueryDto } from './dto/search-query.dto';
import { toSearchCriteria } from './search-criteria.mapper';

const config: SearchConfig = {
  defaultPageSize: 20,
  maxPageSize: 100,
  suggestMaxHits: 5,
  maxResultWindow: 10_000,
};

function dto(values: Partial<SearchQueryDto>): SearchQueryDto {
  return Object.assign(new SearchQueryDto(), values);
}

describe('toSearchCriteria (design D11)', () => {
  it('defaults to relevance when a query is present', () => {
    // Arrange & Act
    const criteria = toSearchCriteria(dto({ q: 'drill' }), config);

    // Assert
    expect(criteria).toMatchObject({ query: 'drill', sort: 'relevance', order: 'desc', page: 1 });
    expect(criteria.pageSize).toBe(20);
  });

  it('defaults to popularity in browse mode, where relevance would be meaningless', () => {
    // Arrange & Act
    const criteria = toSearchCriteria(dto({}), config);

    // Assert
    expect(criteria.query).toBeUndefined();
    expect(criteria.sort).toBe('popularity');
  });

  it.each([
    ['whitespace only', '   '],
    ['empty', ''],
  ])('treats a %s query as absent, not as a query for nothing', (_name, q) => {
    // Arrange & Act
    const criteria = toSearchCriteria(dto({ q }), config);

    // Assert
    expect(criteria.query).toBeUndefined();
    expect(criteria.sort).toBe('popularity');
  });

  it('trims the query so a stray space does not change the cache key', () => {
    // Arrange & Act
    const criteria = toSearchCriteria(dto({ q: '  drill  ' }), config);

    // Assert
    expect(criteria.query).toBe('drill');
  });

  it('keeps an explicit sort and order over the defaults', () => {
    // Arrange & Act
    const criteria = toSearchCriteria(
      dto({ q: 'drill', sort: 'created_at', order: 'asc' }),
      config,
    );

    // Assert
    expect(criteria).toMatchObject({ sort: 'created_at', order: 'asc' });
  });

  it('passes the filters through untouched', () => {
    // Arrange & Act
    const criteria = toSearchCriteria(
      dto({
        category: 'Tools',
        subcategory: ['Drills'],
        location: 'Berlin',
        minPrice: 10,
        maxPrice: 500,
      }),
      config,
    );

    // Assert
    expect(criteria.filters).toEqual({
      category: 'Tools',
      subcategories: ['Drills'],
      location: 'Berlin',
      minPrice: 10,
      maxPrice: 500,
    });
  });

  it('honours an explicit page and pageSize', () => {
    // Arrange & Act
    const criteria = toSearchCriteria(dto({ page: 3, pageSize: 50 }), config);

    // Assert
    expect(criteria).toMatchObject({ page: 3, pageSize: 50 });
  });
});
