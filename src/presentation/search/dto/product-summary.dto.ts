import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A search hit as the client sees it. Structurally the `ProductSummary` read
 * model, restated as a presentation class so the published contract carries the
 * real field names and types instead of an opaque object.
 */
export class ProductSummaryDto {
  @ApiProperty({ example: 'tool-001' })
  id!: string;

  @ApiProperty({ example: 'Cordless Drill 18V' })
  name!: string;

  @ApiProperty({ example: 'Compact 18V brushless cordless drill with two batteries.' })
  description!: string;

  @ApiProperty({ example: 'Tools' })
  category!: string;

  @ApiProperty({ type: [String], example: ['Power Tools', 'Drills'] })
  subcategories!: string[];

  @ApiProperty({ example: 'Berlin' })
  location!: string;

  @ApiProperty({ example: 149.99 })
  price!: number;

  @ApiProperty({ example: 'USD' })
  currency!: string;

  @ApiProperty({ description: 'Popularity signal used by relevance scoring.', example: 87 })
  popularity!: number;

  @ApiProperty({ format: 'date-time', example: '2026-03-14T00:00:00.000Z' })
  createdAt!: string;

  @ApiPropertyOptional({
    description: 'Relevance score. Present when ranking by relevance, absent when browsing.',
    example: 12.43,
  })
  score?: number;
}
