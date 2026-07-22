import { toFacets } from './facet-response.mapper';

describe('toFacets', () => {
  it('returns empty facets when aggregations are absent', () => {
    expect(toFacets(undefined)).toEqual({
      categories: [],
      subcategories: [],
      locations: [],
      priceRanges: [],
    });
  });

  it('maps terms and range buckets into facet buckets', () => {
    // Arrange
    const aggregations = {
      categories: {
        values: {
          buckets: [
            { key: 'Tools', doc_count: 6 },
            { key: 'Electronics', doc_count: 5 },
          ],
        },
      },
      subcategories: { values: { buckets: [{ key: 'Drills', doc_count: 3 }] } },
      locations: { values: { buckets: [{ key: 'Berlin', doc_count: 4 }] } },
      priceRanges: {
        values: {
          buckets: [
            { to: 50, doc_count: 7 },
            { from: 50, to: 100, doc_count: 8 },
            { from: 500, doc_count: 2 },
          ],
        },
      },
    };

    // Act & Assert
    expect(toFacets(aggregations)).toEqual({
      categories: [
        { key: 'Tools', count: 6 },
        { key: 'Electronics', count: 5 },
      ],
      subcategories: [{ key: 'Drills', count: 3 }],
      locations: [{ key: 'Berlin', count: 4 }],
      priceRanges: [
        { to: 50, count: 7 },
        { from: 50, to: 100, count: 8 },
        { from: 500, count: 2 },
      ],
    });
  });
});
