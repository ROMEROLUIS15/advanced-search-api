import { Module } from '@nestjs/common';
import { ServiceIndexController } from '@presentation/service-index/service-index.controller';

/** Service index module: the landing route at `GET /`. Static — no ports, no dependencies. */
@Module({
  controllers: [ServiceIndexController],
})
export class ServiceIndexModule {}
