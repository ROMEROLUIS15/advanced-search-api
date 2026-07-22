import { buildFacetAggregations } from './facet-aggregations.builder';
import type { SearchFilters } from '@application/models/search-criteria';

const filters: SearchFilters = {
  category: 'Tools',
  subcategories: ['Drills'],
  location: 'Berlin',
  minPrice: 10,
  maxPrice: 100,
};

describe('buildFacetAggregations', () => {
  const aggs: any = buildFacetAggregations(filters);

  it('produces a filtered sub-aggregation per facet dimension', () => {
    expect(Object.keys(aggs)).toEqual(['categories', 'subcategories', 'locations', 'priceRanges']);
    expect(aggs.categories.aggs.values.terms.field).toBe('category');
    expect(aggs.subcategories.aggs.values.terms.field).toBe('subcategories');
    expect(aggs.locations.aggs.values.terms.field).toBe('location');
    expect(aggs.priceRanges.aggs.values.range.field).toBe('price');
  });

  it('excludes its own dimension from each facet filter (design D4)', () => {
    // The categories facet keeps subcategory/location/price filters but drops category.
    expect(aggs.categories.filter.bool.filter).toEqual([
      { terms: { subcategories: ['Drills'] } },
      { term: { location: { value: 'Berlin' } } },
      { range: { price: { gte: 10, lte: 100 } } },
    ]);
    // The price facet drops the price range but keeps the term filters.
    expect(aggs.priceRanges.filter.bool.filter).toEqual([
      { term: { category: { value: 'Tools' } } },
      { terms: { subcategories: ['Drills'] } },
      { term: { location: { value: 'Berlin' } } },
    ]);
  });

  it('defines configurable price buckets', () => {
    expect(aggs.priceRanges.aggs.values.range.ranges).toEqual([
      { to: 50 },
      { from: 50, to: 100 },
      { from: 100, to: 500 },
      { from: 500 },
    ]);
  });
});
