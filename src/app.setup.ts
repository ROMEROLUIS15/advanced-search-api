import { type INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import type { AppConfiguration } from '@config/app-config';
import { AllExceptionsFilter } from '@presentation/common/all-exceptions.filter';
import { LoggingInterceptor } from '@presentation/common/logging.interceptor';

/**
 * Global HTTP configuration shared by the running app (main.ts) and the e2e
 * tests, so both exercise the same pipeline (design D13).
 */
export function configureApp(app: INestApplication, config: AppConfiguration): void {
  // Security headers; CSP disabled for a JSON API with no browser-rendered HTML.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({ origin: resolveCorsOrigin(config) });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableShutdownHooks();
}

/** Env-aware CORS (design D13): an explicit list wins; else reflect in dev, same-origin in prod. */
export function resolveCorsOrigin(config: AppConfiguration): string[] | boolean {
  const { corsOrigins, nodeEnv } = config.app;
  if (corsOrigins.length > 0) {
    return corsOrigins;
  }
  return nodeEnv !== 'production';
}
