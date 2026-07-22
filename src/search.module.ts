import { Module } from '@nestjs/common';
import { ElasticsearchModule } from '@infrastructure/elasticsearch/elasticsearch.module';
import { SearchProductsUseCase } from '@application/use-cases/search-products.use-case';
import { SearchController } from '@presentation/search/search.controller';

/**
 * Product-search feature module: composes the search use-case (bound to the ES
 * adapter via ElasticsearchModule) and exposes the HTTP controller.
 */
@Module({
  imports: [ElasticsearchModule],
  providers: [SearchProductsUseCase],
  controllers: [SearchController],
})
export class SearchModule {}
