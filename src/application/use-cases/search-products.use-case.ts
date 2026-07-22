import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import type { SearchCriteria } from '../models/search-criteria';
import type { SearchOutcome } from '../models/search-outcome';
import { PRODUCT_SEARCH_PORT, type ProductSearchPort } from '../ports/product-search.port';
import { CACHE_PORT, type CachePort } from '../ports/cache.port';
import { cacheAside } from '../caching/cache-aside';
import { buildSearchCacheKey } from '../caching/search-cache-key';

/**
 * Runs a product search with a fail-open cache-aside layer (design D8). Caching is
 * a pure optimization: any Redis error degrades to Elasticsearch, never an error.
 */
@Injectable()
export class SearchProductsUseCase {
  private readonly logger = new Logger(SearchProductsUseCase.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(PRODUCT_SEARCH_PORT) private readonly productSearch: ProductSearchPort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.ttlSeconds = config.cache.searchTtlSeconds;
  }

  execute(criteria: SearchCriteria): Promise<SearchOutcome> {
    return cacheAside({
      cache: this.cache,
      key: buildSearchCacheKey(criteria),
      ttlSeconds: this.ttlSeconds,
      load: () => this.productSearch.search(criteria),
      logger: this.logger,
    });
  }
}
