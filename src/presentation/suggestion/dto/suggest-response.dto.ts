import { ApiProperty } from '@nestjs/swagger';
import { SearchSuggestionsDto } from '../../common/dto/suggestions.dto';

/** Response envelope for `GET /suggest`, which always returns the block. */
export class SuggestResponseDto {
  @ApiProperty({ type: SearchSuggestionsDto })
  data!: SearchSuggestionsDto;
}
