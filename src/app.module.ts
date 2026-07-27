import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/config.module';
import { ObservabilityModule } from '@infrastructure/observability/observability.module';
import { ApiAuthModule } from './api-auth.module';
import { MetricsModule } from './metrics.module';
import { SearchModule } from './search.module';
import { AutocompleteModule } from './autocomplete.module';
import { SuggestionModule } from './suggestion.module';
import { HealthModule } from './health.module';
import { ServiceIndexModule } from './service-index.module';
import { RateLimitModule } from './rate-limit.module';

/** Root module. Composes the global config module and the feature modules. */
@Module({
  imports: [
    AppConfigModule,
    ObservabilityModule,
    MetricsModule,
    // Order matters: global guards run in registration order, and rate limiting
    // must precede authentication so an unauthenticated flood still consumes a
    // budget instead of being rejected for free (design D30).
    RateLimitModule,
    ApiAuthModule,
    SearchModule,
    AutocompleteModule,
    SuggestionModule,
    HealthModule,
    ServiceIndexModule,
  ],
})
export class AppModule {}
