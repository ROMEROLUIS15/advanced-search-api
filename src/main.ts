import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

/**
 * Application entry point.
 *
 * Cross-cutting bootstrap concerns are layered in by later task groups:
 * - global `ValidationPipe` and typed config (group 2 / 6),
 * - global `AllExceptionsFilter` (group 13),
 * - Helmet + environment-aware CORS (group 13, design D13).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

void bootstrap();
