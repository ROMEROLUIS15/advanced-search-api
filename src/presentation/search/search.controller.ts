import { BadRequestException, Controller, Get, Inject, Query } from '@nestjs/common';
import { APP_CONFIG, type AppConfiguration, type SearchConfig } from '@config/app-config';
import { SearchProductsUseCase } from '@application/use-cases/search-products.use-case';
import { SearchQueryDto } from './dto/search-query.dto';
import type { SearchResponseDto } from './dto/search-response.dto';
import { toSearchCriteria } from './search-criteria.mapper';
import { toSearchResponseDto } from './search-response.mapper';

@Controller('search')
export class SearchController {
  private readonly searchConfig: SearchConfig;

  constructor(
    private readonly searchProducts: SearchProductsUseCase,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.searchConfig = config.search;
  }

  @Get()
  async search(@Query() query: SearchQueryDto): Promise<SearchResponseDto> {
    this.assertPageSizeWithinLimit(query.pageSize);
    const criteria = toSearchCriteria(query, this.searchConfig);
    const outcome = await this.searchProducts.execute(criteria);
    return toSearchResponseDto(outcome, criteria);
  }

  private assertPageSizeWithinLimit(pageSize: number | undefined): void {
    if (pageSize !== undefined && pageSize > this.searchConfig.maxPageSize) {
      throw new BadRequestException(`pageSize must not exceed ${this.searchConfig.maxPageSize}`);
    }
  }
}
