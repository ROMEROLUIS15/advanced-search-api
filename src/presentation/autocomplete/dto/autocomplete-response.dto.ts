import { ApiProperty } from '@nestjs/swagger';

/** A single type-ahead completion. */
export class AutocompleteItemDto {
  @ApiProperty({ example: 'Cordless Drill 18V' })
  text!: string;

  @ApiProperty({ description: 'Prefix-match score from Elasticsearch.', example: 1 })
  score!: number;
}

/** Response envelope for `GET /autocomplete`. */
export class AutocompleteResponseDto {
  @ApiProperty({ type: [AutocompleteItemDto] })
  data!: AutocompleteItemDto[];
}
