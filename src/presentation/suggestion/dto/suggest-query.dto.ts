import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { MAX_QUERY_LENGTH } from '../../common/input-limits';

/** Validated query parameters for `GET /suggest`. */
export class SuggestQueryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_QUERY_LENGTH)
  q!: string;
}
