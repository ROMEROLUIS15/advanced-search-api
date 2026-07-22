import type { Facets, FacetBucket, PriceRangeBucket } from '@application/models/facets';

// Minimal shapes we read from the filtered sub-aggregations (design D4).
interface TermsBucket {
  key: string | number;
  doc_count: number;
}
interface RangeBucket {
  from?: number;
  to?: number;
  doc_count: number;
}
interface TermsFacetAgg {
  values?: { buckets?: TermsBucket[] };
}
interface RangeFacetAgg {
  values?: { buckets?: RangeBucket[] };
}
interface FacetAggregations {
  categories?: TermsFacetAgg;
  subcategories?: TermsFacetAgg;
  locations?: TermsFacetAgg;
  priceRanges?: RangeFacetAgg;
}

/** Maps the filtered facet sub-aggregations into the response `facets` block. */
export function toFacets(aggregations: unknown): Facets {
  const aggs = aggregations as FacetAggregations | undefined;
  return {
    categories: toFacetBuckets(aggs?.categories),
    subcategories: toFacetBuckets(aggs?.subcategories),
    locations: toFacetBuckets(aggs?.locations),
    priceRanges: toPriceBuckets(aggs?.priceRanges),
  };
}

function toFacetBuckets(agg: TermsFacetAgg | undefined): FacetBucket[] {
  const buckets = agg?.values?.buckets ?? [];
  return buckets.map((bucket) => ({ key: String(bucket.key), count: bucket.doc_count }));
}

function toPriceBuckets(agg: RangeFacetAgg | undefined): PriceRangeBucket[] {
  const buckets = agg?.values?.buckets ?? [];
  return buckets.map((bucket) => ({
    ...(bucket.from !== undefined ? { from: bucket.from } : {}),
    ...(bucket.to !== undefined ? { to: bucket.to } : {}),
    count: bucket.doc_count,
  }));
}
