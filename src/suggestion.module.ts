import { Module } from '@nestjs/common';
import { ElasticsearchModule } from '@infrastructure/elasticsearch/elasticsearch.module';
import { SuggestQueriesUseCase } from '@application/use-cases/suggest-queries.use-case';
import { SuggestionController } from '@presentation/suggestion/suggestion.controller';

/** Query-suggestions feature module: the `GET /suggest` use-case (ES adapter) and controller. */
@Module({
  imports: [ElasticsearchModule],
  providers: [SuggestQueriesUseCase],
  controllers: [SuggestionController],
})
export class SuggestionModule {}
