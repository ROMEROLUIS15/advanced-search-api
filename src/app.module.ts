import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/config.module';
import { SearchModule } from './search.module';
import { AutocompleteModule } from './autocomplete.module';
import { SuggestionModule } from './suggestion.module';
import { HealthModule } from './health.module';
import { ServiceIndexModule } from './service-index.module';
import { RateLimitModule } from './rate-limit.module';
// TEMPORARY: diagnostic route to confirm Render's proxy hops. Remove with the module.
import { DiagnosticsModule } from './diagnostics.module';

/** Root module. Composes the global config module and the feature modules. */
@Module({
  imports: [
    AppConfigModule,
    RateLimitModule,
    SearchModule,
    AutocompleteModule,
    SuggestionModule,
    HealthModule,
    ServiceIndexModule,
    DiagnosticsModule,
  ],
})
export class AppModule {}
