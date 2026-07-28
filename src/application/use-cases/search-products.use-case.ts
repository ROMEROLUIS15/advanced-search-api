import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import type { SearchCriteria } from '../models/search-criteria';
import type { SearchOutcome } from '../models/search-outcome';
import { PRODUCT_SEARCH_PORT, type ProductSearchPort } from '../ports/product-search.port';
import { CACHE_PORT, type CachePort } from '../ports/cache.port';
import { METRICS_PORT, type MetricsPort } from '../ports/metrics.port';
import { cacheAside } from '../caching/cache-aside';
import { searchOutcomeSchema } from '../caching/cached-payload.schema';
import { buildSearchCacheKey } from '../caching/search-cache-key';
import { searchCacheScope } from '../caching/cache-scope';

/**
 * Runs a product search with a fail-open cache-aside layer (design D8). Caching is
 * a pure optimization: any Redis error degrades to Elasticsearch, never an error.
 */
@Injectable()
export class SearchProductsUseCase {
  private readonly logger = new Logger(SearchProductsUseCase.name);
  private readonly ttlSeconds: number;
  /** Computed once: configuration cannot change without restarting the process. */
  private readonly cacheScope: string;

  constructor(
    @Inject(PRODUCT_SEARCH_PORT) private readonly productSearch: ProductSearchPort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(METRICS_PORT) private readonly metrics: MetricsPort,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.ttlSeconds = config.cache.searchTtlSeconds;
    this.cacheScope = searchCacheScope(config);
  }

  execute(criteria: SearchCriteria): Promise<SearchOutcome> {
    return cacheAside({
      cache: this.cache,
      key: buildSearchCacheKey(criteria, this.cacheScope),
      ttlSeconds: this.ttlSeconds,
      load: () => this.productSearch.search(criteria),
      logger: this.logger,
      metrics: this.metrics,
      schema: searchOutcomeSchema,
    });
  }
}
