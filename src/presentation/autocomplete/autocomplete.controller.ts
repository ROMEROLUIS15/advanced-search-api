import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AutocompleteUseCase } from '@application/use-cases/autocomplete.use-case';
import { ApiErrorResponses } from '../common/api-error-responses.decorator';
import { AutocompleteQueryDto } from './dto/autocomplete-query.dto';
import { AutocompleteResponseDto } from './dto/autocomplete-response.dto';

const DEFAULT_LIMIT = 10;

@ApiTags('autocomplete')
@Controller('autocomplete')
export class AutocompleteController {
  constructor(private readonly autocomplete: AutocompleteUseCase) {}

  @Get()
  @ApiOperation({
    summary: 'Type-ahead completions',
    description: 'Prefix matches over product names, ordered by score.',
  })
  @ApiOkResponse({ type: AutocompleteResponseDto })
  @ApiErrorResponses(400, 429, 503)
  async complete(@Query() query: AutocompleteQueryDto): Promise<AutocompleteResponseDto> {
    const items = await this.autocomplete.execute(query.q, query.limit ?? DEFAULT_LIMIT);
    return { data: items };
  }
}
