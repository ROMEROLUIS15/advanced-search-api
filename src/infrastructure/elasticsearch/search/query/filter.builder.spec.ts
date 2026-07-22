import { buildFilterClauses } from './filter.builder';

describe('buildFilterClauses', () => {
  it('returns no clauses when no filters are set', () => {
    expect(buildFilterClauses({})).toEqual([]);
  });

  it('builds term/terms/range clauses and combines them', () => {
    // Act
    const clauses = buildFilterClauses({
      category: 'Tools',
      subcategories: ['Drills', 'Grinders'],
      location: 'Berlin',
      minPrice: 10,
      maxPrice: 100,
    });

    // Assert
    expect(clauses).toEqual([
      { term: { category: { value: 'Tools' } } },
      { terms: { subcategories: ['Drills', 'Grinders'] } },
      { term: { location: { value: 'Berlin' } } },
      { range: { price: { gte: 10, lte: 100 } } },
    ]);
  });

  it('supports an open-ended price range', () => {
    expect(buildFilterClauses({ minPrice: 50 })).toEqual([{ range: { price: { gte: 50 } } }]);
  });
});
