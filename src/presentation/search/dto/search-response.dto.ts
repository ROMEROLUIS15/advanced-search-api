import { ApiProperty } from '@nestjs/swagger';
import type { SortField, SortOrder } from '@application/models/search-criteria';
import { SearchSuggestionsDto } from '../../common/dto/suggestions.dto';
import { FacetsDto } from './facets.dto';
import { ProductSummaryDto } from './product-summary.dto';

/** Pagination and the sort actually applied, echoed back so a client never guesses. */
export class SearchMetaDto {
  @ApiProperty({ description: 'Total matching documents, not the page size.', example: 24 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  pageSize!: number;

  @ApiProperty({ example: 2 })
  totalPages!: number;

  @ApiProperty({
    enum: ['relevance', 'popularity', 'created_at'],
    description: 'Defaults to relevance with a query, popularity while browsing.',
    example: 'relevance',
  })
  sort!: SortField;

  @ApiProperty({ enum: ['asc', 'desc'], example: 'desc' })
  order!: SortOrder;
}

/** Response envelope for `GET /search`. Built by a mapper — never a domain entity. */
export class SearchResponseDto {
  @ApiProperty({ type: [ProductSummaryDto] })
  data!: ProductSummaryDto[];

  @ApiProperty({ type: SearchMetaDto })
  meta!: SearchMetaDto;

  @ApiProperty({ type: FacetsDto })
  facets!: FacetsDto;

  @ApiProperty({
    type: SearchSuggestionsDto,
    description: 'Populated only on low recall; empty otherwise (design D7).',
  })
  suggestions!: SearchSuggestionsDto;
}
