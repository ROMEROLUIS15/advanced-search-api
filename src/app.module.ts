import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/config.module';
import { ElasticsearchModule } from '@infrastructure/elasticsearch/elasticsearch.module';
import { SearchModule } from './search.module';

/**
 * Root module. Composes the global config module, shared infrastructure, and the
 * feature modules; later groups add the health/indexing wiring (groups 5, 12).
 */
@Module({
  imports: [AppConfigModule, ElasticsearchModule, SearchModule],
})
export class AppModule {}
