import { IsNotEmpty, IsString } from 'class-validator';

/** Validated query parameters for `GET /suggest`. */
export class SuggestQueryDto {
  @IsString()
  @IsNotEmpty()
  q!: string;
}
