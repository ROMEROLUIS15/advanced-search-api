import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/config.module';
import { SearchModule } from './search.module';
import { AutocompleteModule } from './autocomplete.module';
import { SuggestionModule } from './suggestion.module';

/**
 * Root module. Composes the global config module and the feature modules; the
 * health module is added in group 12.
 */
@Module({
  imports: [AppConfigModule, SearchModule, AutocompleteModule, SuggestionModule],
})
export class AppModule {}
