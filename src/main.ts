import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { configureApp } from './app.setup';
import { installProcessSafetyNet } from './process-safety-net';

/**
 * Application entry point. Environment is validated at boot (the config provider
 * fails fast on invalid/missing variables); global HTTP concerns are applied by
 * {@link configureApp}; failures outside the request cycle are caught by
 * {@link installProcessSafetyNet}.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get<AppConfiguration>(APP_CONFIG);
  configureApp(app, config);
  installProcessSafetyNet(app);
  await app.listen(config.app.port);
}

void bootstrap();
