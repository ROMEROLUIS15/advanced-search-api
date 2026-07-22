import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { errorMessage } from '@shared/error-message';
import type { SearchCriteria } from '../models/search-criteria';
import type { SearchOutcome } from '../models/search-outcome';
import { PRODUCT_SEARCH_PORT, type ProductSearchPort } from '../ports/product-search.port';
import { CACHE_PORT, type CachePort } from '../ports/cache.port';
import { buildSearchCacheKey } from '../caching/search-cache-key';

/**
 * Runs a product search with a cache-aside layer (design D8). Caching is a pure
 * optimization: any Redis error is treated as a miss and the request falls
 * through to Elasticsearch (fail-open); writes are best-effort.
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

  async execute(criteria: SearchCriteria): Promise<SearchOutcome> {
    const key = buildSearchCacheKey(criteria);

    const cached = await this.readCache(key);
    if (cached) {
      return cached;
    }

    const outcome = await this.productSearch.search(criteria);
    await this.writeCache(key, outcome);
    return outcome;
  }

  private async readCache(key: string): Promise<SearchOutcome | null> {
    try {
      return await this.cache.get<SearchOutcome>(key);
    } catch (error) {
      this.logger.warn(`Cache read failed (${key}): ${errorMessage(error)}`);
      return null;
    }
  }

  private async writeCache(key: string, outcome: SearchOutcome): Promise<void> {
    try {
      await this.cache.set(key, outcome, this.ttlSeconds);
    } catch (error) {
      this.logger.warn(`Cache write failed (${key}): ${errorMessage(error)}`);
    }
  }
}
