import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { AllExceptionsFilter } from '@presentation/common/all-exceptions.filter';

/**
 * Application entry point.
 *
 * Environment is validated at boot: building the module graph instantiates the
 * config provider, which fails fast (throws) on invalid/missing variables.
 *
 * Still to be layered in: Helmet + environment-aware CORS (group 13, design D13).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();

  const config = app.get<AppConfiguration>(APP_CONFIG);
  await app.listen(config.app.port);
}

void bootstrap();
