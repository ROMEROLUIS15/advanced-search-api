import { Module } from '@nestjs/common';
import { ElasticsearchModule } from '@infrastructure/elasticsearch/elasticsearch.module';
import { RedisModule } from '@infrastructure/redis/redis.module';
import { AutocompleteUseCase } from '@application/use-cases/autocomplete.use-case';
import { AutocompleteController } from '@presentation/autocomplete/autocomplete.controller';

/** Autocomplete feature module: the type-ahead use-case (ES adapter + Redis cache) and its controller. */
@Module({
  imports: [ElasticsearchModule, RedisModule],
  providers: [AutocompleteUseCase],
  controllers: [AutocompleteController],
})
export class AutocompleteModule {}
