import { BadRequestException, Controller, Get, Inject, Query, Res } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { APP_CONFIG, type AppConfiguration, type SearchConfig } from '@config/app-config';
import { SearchProductsUseCase } from '@application/use-cases/search-products.use-case';
import { API_KEY_HEADER } from '@presentation/auth/api-key.identity';
import { ApiErrorResponses } from '../common/api-error-responses.decorator';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { toSearchCriteria } from './search-criteria.mapper';
import { toSearchResponseDto } from './search-response.mapper';

@ApiTags('search')
@Controller('search')
export class SearchController {
  private readonly searchConfig: SearchConfig;
  private readonly cacheTtlSeconds: number;

  constructor(
    private readonly searchProducts: SearchProductsUseCase,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.searchConfig = config.search;
    this.cacheTtlSeconds = config.cache.searchTtlSeconds;
  }

  @Get()
  @ApiOperation({
    summary: 'Search products',
    description:
      'Relevance-ranked hits with facet counts and, on low recall, spelling suggestions. ' +
      'An empty `q` browses the catalogue sorted by popularity.',
  })
  @ApiOkResponse({ type: SearchResponseDto })
  @ApiErrorResponses(400, 422, 429, 503)
  async search(
    @Query() query: SearchQueryDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<SearchResponseDto> {
    this.assertPageSizeWithinLimit(query.pageSize);
    const criteria = toSearchCriteria(query, this.searchConfig);
    const outcome = await this.searchProducts.execute(criteria);
    // Say out loud what the service already does internally (design D28): these
    // results sit in Redis for the same window, and the index is read-only.
    //
    // `private`, never `public`: the response is only reachable with a valid
    // X-API-Key, and a shared cache holding it would serve one client's
    // authenticated answer to whoever asked next — the guard bypassed by a proxy
    // rather than by an attacker. `Vary` is the belt to that braces, for any
    // intermediary that stores the response anyway: it must at least key it by
    // the credential it was fetched with.
    response.setHeader('Cache-Control', `private, max-age=${this.cacheTtlSeconds}`);
    response.setHeader('Vary', API_KEY_HEADER);
    return toSearchResponseDto(outcome, criteria);
  }

  private assertPageSizeWithinLimit(pageSize: number | undefined): void {
    if (pageSize !== undefined && pageSize > this.searchConfig.maxPageSize) {
      throw new BadRequestException(`pageSize must not exceed ${this.searchConfig.maxPageSize}`);
    }
  }
}
