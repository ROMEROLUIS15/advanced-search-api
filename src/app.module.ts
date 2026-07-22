import { Module } from '@nestjs/common';
import { SearchModule } from './search.module';

/**
 * Root module. Composes the feature modules; later groups add the global
 * `ConfigModule` (group 2) and the health/indexing modules (groups 5, 12).
 */
@Module({
  imports: [SearchModule],
})
export class AppModule {}
