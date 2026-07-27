import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One value of a facet dimension and how many documents carry it. */
export class FacetBucketDto {
  @ApiProperty({ example: 'Tools' })
  key!: string;

  @ApiProperty({ example: 8 })
  count!: number;
}

/** A price bucket. Both bounds are optional: the extreme buckets are open-ended. */
export class PriceRangeBucketDto {
  @ApiPropertyOptional({ description: 'Inclusive lower bound.', example: 50 })
  from?: number;

  @ApiPropertyOptional({ description: 'Exclusive upper bound.', example: 100 })
  to?: number;

  @ApiProperty({ example: 5 })
  count!: number;
}

/**
 * Aggregation counts returned alongside the hits (design D4). Each dimension is
 * computed with every *other* selected filter applied but not its own, which is
 * what lets a client widen a dimension it already narrowed.
 */
export class FacetsDto {
  @ApiProperty({ type: [FacetBucketDto] })
  categories!: FacetBucketDto[];

  @ApiProperty({ type: [FacetBucketDto] })
  subcategories!: FacetBucketDto[];

  @ApiProperty({ type: [FacetBucketDto] })
  locations!: FacetBucketDto[];

  @ApiProperty({ type: [PriceRangeBucketDto] })
  priceRanges!: PriceRangeBucketDto[];
}
