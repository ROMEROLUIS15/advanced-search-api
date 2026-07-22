import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import type { AutocompleteItem } from '../models/autocomplete-item';
import { AUTOCOMPLETE_PORT, type AutocompletePort } from '../ports/autocomplete.port';
import { CACHE_PORT, type CachePort } from '../ports/cache.port';
import { cacheAside } from '../caching/cache-aside';
import { buildAutocompleteCacheKey } from '../caching/autocomplete-cache-key';

/** Type-ahead completions with a short-lived, fail-open cache-aside layer (design D6). */
@Injectable()
export class AutocompleteUseCase {
  private readonly logger = new Logger(AutocompleteUseCase.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(AUTOCOMPLETE_PORT) private readonly autocomplete: AutocompletePort,
    @Inject(CACHE_PORT) private readonly cache: CachePort,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.ttlSeconds = config.cache.autocompleteTtlSeconds;
  }

  execute(prefix: string, limit: number): Promise<AutocompleteItem[]> {
    return cacheAside({
      cache: this.cache,
      key: buildAutocompleteCacheKey(prefix, limit),
      ttlSeconds: this.ttlSeconds,
      load: () => this.autocomplete.complete(prefix, limit),
      logger: this.logger,
    });
  }
}
