import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import type { AppConfiguration } from '@config/app-config';
import { AllExceptionsFilter } from '@presentation/common/all-exceptions.filter';
import { LoggingInterceptor } from '@presentation/common/logging.interceptor';

/**
 * Global HTTP configuration shared by the running app (main.ts) and the e2e
 * tests, so both exercise the same pipeline (design D13).
 */
export function configureApp(app: INestApplication, config: AppConfiguration): void {
  // Trust exactly the configured number of proxy hops so req.ip comes from
  // X-Forwarded-For behind Render, and no further, so a client cannot forge its
  // own address past the rate limiter (design D16). Set before anything reads ip.
  configureProxyTrust(app, config);
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

/**
 * Applies the proxy-trust hop count to the underlying Express instance (design
 * D16). A count of 0 trusts nothing, correct for a direct local connection; on
 * Render, 1 trusts only the platform proxy. Skipped when the HTTP adapter is not
 * Express (e.g. a test harness), where there is no proxy to resolve.
 */
export function configureProxyTrust(app: INestApplication, config: AppConfiguration): void {
  const expressApp = app as NestExpressApplication;
  if (typeof expressApp.set === 'function') {
    expressApp.set('trust proxy', config.rateLimit.trustProxyHops);
  }
}

/** Env-aware CORS (design D13): an explicit list wins; else reflect in dev, same-origin in prod. */
export function resolveCorsOrigin(config: AppConfiguration): string[] | boolean {
  const { corsOrigins, nodeEnv } = config.app;
  if (corsOrigins.length > 0) {
    return corsOrigins;
  }
  return nodeEnv !== 'production';
}
