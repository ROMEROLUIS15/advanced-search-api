import 'reflect-metadata';
// Must stay directly below reflect-metadata and above everything else: OpenTelemetry
// patches modules as they are required, so any import placed above this line loads
// http, Express, ioredis or the Elasticsearch client untraced (design D25).
import { startTracing } from '@infrastructure/observability/tracing.bootstrap';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import { PinoLoggerAdapter } from '@infrastructure/observability/pino-logger.adapter';
import { configureApp } from './app.setup';
import { setupOpenApi } from './swagger.setup';
import { installProcessSafetyNet } from './process-safety-net';

/**
 * Application entry point. Environment is validated at boot (the config provider
 * fails fast on invalid/missing variables); global HTTP concerns are applied by
 * {@link configureApp}; the OpenAPI contract is published by {@link setupOpenApi};
 * failures outside the request cycle are caught by {@link installProcessSafetyNet}.
 */
async function bootstrap(): Promise<void> {
  const tracing = startTracing();
  // bufferLogs holds the bootstrap lines until the structured logger exists, so
  // startup is machine-readable too instead of the first few lines being text.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  const config = app.get<AppConfiguration>(APP_CONFIG);
  app.useLogger(new PinoLoggerAdapter(config));
  // Whether traces are leaving the process is not something anyone should have to
  // infer from an empty dashboard.
  new Logger('Bootstrap').log(
    tracing ? 'Tracing enabled, exporting over OTLP' : 'Tracing disabled: no OTLP endpoint set',
  );
  configureApp(app, config);
  setupOpenApi(app, config);
  installProcessSafetyNet(app);
  await app.listen(config.app.port);
}

void bootstrap();
