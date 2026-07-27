import { ApiProperty } from '@nestjs/swagger';

/**
 * Suggestion block (design D7). Shared on purpose: `GET /suggest` always returns
 * it and `GET /search` embeds the same shape on low recall, so both endpoints
 * must publish one schema rather than two that can drift.
 */
export class SearchSuggestionsDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Best corrected phrase, or null when nothing beats the original.',
    example: 'drill',
  })
  didYouMean!: string | null;

  @ApiProperty({
    type: [String],
    description: 'Alternative queries worth trying.',
    example: ['drill', 'drills'],
  })
  related!: string[];
}
