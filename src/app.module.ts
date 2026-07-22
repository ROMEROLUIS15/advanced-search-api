import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/config.module';
import { SearchModule } from './search.module';
import { AutocompleteModule } from './autocomplete.module';
import { SuggestionModule } from './suggestion.module';
import { HealthModule } from './health.module';

/** Root module. Composes the global config module and the feature modules. */
@Module({
  imports: [AppConfigModule, SearchModule, AutocompleteModule, SuggestionModule, HealthModule],
})
export class AppModule {}
