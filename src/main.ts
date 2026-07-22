import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { configureApp } from './app.setup';

/**
 * Application entry point. Environment is validated at boot (the config provider
 * fails fast on invalid/missing variables); global HTTP concerns are applied by
 * {@link configureApp}.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get<AppConfiguration>(APP_CONFIG);
  configureApp(app, config);
  await app.listen(config.app.port);
}

void bootstrap();
