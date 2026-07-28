import { type INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { METRICS_PORT, type MetricsPort } from '@application/ports/metrics.port';
import type { AppConfiguration } from '@config/app-config';
import { AllExceptionsFilter } from '@presentation/common/all-exceptions.filter';
import { correlationIdMiddleware } from '@presentation/common/correlation-id.middleware';
import { LoggingInterceptor } from '@presentation/common/logging.interceptor';
import { buildMetricsMiddleware } from '@presentation/common/metrics.middleware';

/**
 * Global HTTP configuration shared by the running app (main.ts) and the e2e
 * tests, so both exercise the same pipeline (design D13).
 */
export function configureApp(app: INestApplication, config: AppConfiguration): void {
  // Trust exactly the configured number of proxy hops so req.ip comes from
  // X-Forwarded-For behind Render, and no further, so a client cannot forge its
  // own address past the rate limiter (design D16). Set before anything reads ip.
  configureProxyTrust(app, config);
  // First in the chain: everything downstream — including anything Helmet or the
  // validation pipe rejects — should log under the request's correlation id (D22).
  app.use(correlationIdMiddleware);
  // Ahead of the router, so a request the API-key guard or the rate limiter
  // rejects — or one matching no route at all — is still measured (design D24).
  // A Nest interceptor runs after the global guards and missed exactly those.
  app.use(buildMetricsMiddleware(app.get<MetricsPort>(METRICS_PORT)));
  // Security headers; CSP disabled for a JSON API with no browser-rendered HTML.
  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({ origin: resolveCorsOrigin(config) });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalInterceptors(new LoggingInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter(config));
  app.enableShutdownHooks();
}

/**
 * Applies the proxy-trust hop count to the underlying Express instance (design
 * D16). The value is how many proxies sit in front of the app, counted from the
 * right of `X-Forwarded-For`: 0 trusts nothing, correct for a direct local
 * connection; on Render it is 3 — the platform's internal load balancer,
 * Cloudflare and the edge, confirmed against the live header (see the
 * `TRUST_PROXY_HOPS` comment in `render.yaml`). Skipped when the HTTP adapter is
 * not Express (e.g. a test harness), where there is no proxy to resolve.
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
