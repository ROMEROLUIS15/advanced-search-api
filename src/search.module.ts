import { Module } from '@nestjs/common';
import { ElasticsearchModule } from '@infrastructure/elasticsearch/elasticsearch.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { SearchProductsUseCase } from '@application/use-cases/search-products.use-case';
import { SearchController } from '@presentation/search/search.controller';

/**
 * Product-search feature module: composes the search use-case (bound to the ES
 * adapter and the Redis cache) and exposes the HTTP controller.
 */
@Module({
  imports: [ElasticsearchModule, RedisModule],
  providers: [SearchProductsUseCase],
  controllers: [SearchController],
})
export class SearchModule {}
