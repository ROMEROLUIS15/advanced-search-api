import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/config.module';
import { SearchModule } from './search.module';
import { AutocompleteModule } from './autocomplete.module';

/**
 * Root module. Composes the global config module and the feature modules; later
 * groups add the suggestions and health wiring (groups 11, 12).
 */
@Module({
  imports: [AppConfigModule, SearchModule, AutocompleteModule],
})
export class AppModule {}
