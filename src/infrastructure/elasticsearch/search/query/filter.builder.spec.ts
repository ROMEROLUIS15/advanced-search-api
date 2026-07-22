import { buildFilterClauses, type FacetDimension } from './filter.builder';
import type { SearchFilters } from '@application/models/search-criteria';

const allFilters: SearchFilters = {
  category: 'Tools',
  subcategories: ['Drills', 'Grinders'],
  location: 'Berlin',
  minPrice: 10,
  maxPrice: 100,
};

const categoryClause = { term: { category: { value: 'Tools' } } };
const subcategoriesClause = { terms: { subcategories: ['Drills', 'Grinders'] } };
const locationClause = { term: { location: { value: 'Berlin' } } };
const priceClause = { range: { price: { gte: 10, lte: 100 } } };

describe('buildFilterClauses', () => {
  it('returns no clauses when no filters are set', () => {
    expect(buildFilterClauses({})).toEqual([]);
  });

  it('builds and combines all clauses when no dimension is excluded', () => {
    expect(buildFilterClauses(allFilters)).toEqual([
      categoryClause,
      subcategoriesClause,
      locationClause,
      priceClause,
    ]);
  });

  it('supports an open-ended price range', () => {
    expect(buildFilterClauses({ minPrice: 50 })).toEqual([{ range: { price: { gte: 50 } } }]);
  });

  // Table-driven "exclude own dimension" recipe (design D4) — the highest-risk logic.
  const cases: { exclude: FacetDimension; expected: object[] }[] = [
    { exclude: 'category', expected: [subcategoriesClause, locationClause, priceClause] },
    { exclude: 'subcategories', expected: [categoryClause, locationClause, priceClause] },
    { exclude: 'location', expected: [categoryClause, subcategoriesClause, priceClause] },
    { exclude: 'price', expected: [categoryClause, subcategoriesClause, locationClause] },
  ];

  it.each(cases)('excludes only the $exclude dimension', ({ exclude, expected }) => {
    expect(buildFilterClauses(allFilters, exclude)).toEqual(expected);
  });
});
