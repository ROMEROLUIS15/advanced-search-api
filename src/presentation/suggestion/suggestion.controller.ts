import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SuggestQueriesUseCase } from '@application/use-cases/suggest-queries.use-case';
import { ApiErrorResponses } from '../common/api-error-responses.decorator';
import { SuggestQueryDto } from './dto/suggest-query.dto';
import { SuggestResponseDto } from './dto/suggest-response.dto';

@ApiTags('suggest')
@Controller('suggest')
export class SuggestionController {
  constructor(private readonly suggestQueries: SuggestQueriesUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Did-you-mean and related queries',
    description:
      'Always returns the suggestion block, unlike `/search`, which only surfaces it on low recall.',
  })
  @ApiOkResponse({ type: SuggestResponseDto })
  @ApiErrorResponses(400, 429, 503)
  async suggest(@Query() query: SuggestQueryDto): Promise<SuggestResponseDto> {
    return { data: await this.suggestQueries.execute(query.q) };
  }
}
