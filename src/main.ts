import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';

/**
 * Application entry point.
 *
 * Environment is validated at boot: building the module graph instantiates the
 * config provider, which fails fast (throws) on invalid/missing variables.
 *
 * Cross-cutting bootstrap concerns are layered in by later task groups:
 * - global `ValidationPipe` (group 6),
 * - global `AllExceptionsFilter` (group 13),
 * - Helmet + environment-aware CORS (group 13, design D13).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfiguration>(APP_CONFIG);
  await app.listen(config.app.port);
}

void bootstrap();
