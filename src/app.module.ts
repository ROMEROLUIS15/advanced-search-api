import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/config.module';
import { SearchModule } from './search.module';

/**
 * Root module. Composes the global config module and the feature modules;
 * later groups add the health/indexing modules (groups 5, 12).
 */
@Module({
  imports: [AppConfigModule, SearchModule],
})
export class AppModule {}
