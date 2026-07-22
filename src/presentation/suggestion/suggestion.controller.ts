import { Controller, Get, Query } from '@nestjs/common';
import { SuggestQueriesUseCase } from '@application/use-cases/suggest-queries.use-case';
import { SuggestQueryDto } from './dto/suggest-query.dto';
import type { SuggestResponseDto } from './dto/suggest-response.dto';

@Controller('suggest')
export class SuggestionController {
  constructor(private readonly suggestQueries: SuggestQueriesUseCase) {}

  @Get()
  async suggest(@Query() query: SuggestQueryDto): Promise<SuggestResponseDto> {
    return { data: await this.suggestQueries.execute(query.q) };
  }
}
