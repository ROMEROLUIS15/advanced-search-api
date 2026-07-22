import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

/** Validated query parameters for `GET /autocomplete` (design D11). */
export class AutocompleteQueryDto {
  @IsString()
  @IsNotEmpty()
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  limit?: number;
}
