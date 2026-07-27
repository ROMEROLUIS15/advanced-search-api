import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { APP_CONFIG, type AppConfiguration } from './app-config';
import { loadConfig } from './load-config';

/**
 * Global configuration module (design D12).
 *
 * `@nestjs/config` loads the `.env` file into `process.env`; the `APP_CONFIG`
 * provider then validates it with Zod (fail-fast at boot) and exposes the typed,
 * namespaced {@link AppConfiguration}. Identical code path locally and in cloud —
 * only the env values differ.
 */
@Global()
@Module({
  imports: [NestConfigModule.forRoot({ isGlobal: true, cache: true, expandVariables: true })],
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfiguration => loadConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class AppConfigModule {}
