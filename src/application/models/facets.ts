export interface FacetBucket {
  key: string;
  count: number;
}

export interface PriceRangeBucket {
  /** Inclusive lower bound; omitted for an open-ended lowest bucket. */
  from?: number;
  /** Exclusive upper bound; omitted for an open-ended highest bucket. */
  to?: number;
  count: number;
}

/** Aggregation counts returned alongside search hits (design D4). */
export interface Facets {
  categories: FacetBucket[];
  subcategories: FacetBucket[];
  locations: FacetBucket[];
  priceRanges: PriceRangeBucket[];
}
