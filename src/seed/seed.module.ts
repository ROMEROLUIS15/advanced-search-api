import { Module } from '@nestjs/common';
import { AppConfigModule } from '@config/config.module';
import { ElasticsearchModule } from '@infrastructure/elasticsearch/elasticsearch.module';
import { SeedCatalogUseCase } from '@application/use-cases/seed-catalog.use-case';

/** Minimal module for the seed CLI's standalone application context. */
@Module({
  imports: [AppConfigModule, ElasticsearchModule],
  providers: [SeedCatalogUseCase],
})
export class SeedModule {}
