import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import type { SortField, SortOrder } from '@application/models/search-criteria';
import { MAX_QUERY_LENGTH, MAX_SUBCATEGORIES, MAX_TERM_LENGTH } from '../../common/input-limits';
import { IsNotBelowMinPrice } from '../../common/price-range.validator';

const SORT_FIELDS: SortField[] = ['relevance', 'popularity', 'created_at'];
const SORT_ORDERS: SortOrder[] = ['asc', 'desc'];

/** Validated, whitelisted query parameters for `GET /search` (design D11). */
export class SearchQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(MAX_QUERY_LENGTH)
  q?: string;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TERM_LENGTH)
  category?: string;

  @IsOptional()
  @Transform(({ value }) => toStringArray(value))
  @IsString({ each: true })
  @MaxLength(MAX_TERM_LENGTH, { each: true })
  @ArrayMaxSize(MAX_SUBCATEGORIES)
  subcategory?: string[];

  @IsOptional()
  @IsString()
  @MaxLength(MAX_TERM_LENGTH)
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @IsNotBelowMinPrice()
  maxPrice?: number;

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sort?: SortField;

  @IsOptional()
  @IsIn(SORT_ORDERS)
  order?: SortOrder;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize?: number;
}

/** Normalizes a repeatable or comma-separated query param into a trimmed string list. */
function toStringArray(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return raw.map((item) => String(item).trim()).filter((item) => item.length > 0);
}
