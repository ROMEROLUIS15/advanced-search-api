import { Controller, Get, Query } from '@nestjs/common';
import { AutocompleteUseCase } from '@application/use-cases/autocomplete.use-case';
import { AutocompleteQueryDto } from './dto/autocomplete-query.dto';
import type { AutocompleteResponseDto } from './dto/autocomplete-response.dto';

const DEFAULT_LIMIT = 10;

@Controller('autocomplete')
export class AutocompleteController {
  constructor(private readonly autocomplete: AutocompleteUseCase) {}

  @Get()
  async complete(@Query() query: AutocompleteQueryDto): Promise<AutocompleteResponseDto> {
    const items = await this.autocomplete.execute(query.q, query.limit ?? DEFAULT_LIMIT);
    return { data: items };
  }
}
