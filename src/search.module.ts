import { Module } from '@nestjs/common';

/**
 * Wiring seam for the product-search feature.
 *
 * As the layers are implemented, this module binds application use-cases and
 * infrastructure adapters through their `Symbol` port tokens
 * (`{ provide: TOKEN, useClass: Adapter }`) and registers the presentation
 * controllers. Left intentionally empty in the scaffold (group 1).
 */
@Module({})
export class SearchModule {}
