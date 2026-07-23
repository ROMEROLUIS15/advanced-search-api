import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, buildConfig, type AppConfiguration } from '../src/config/app-config';
import { validateEnv } from '../src/config/env.schema';

/**
 * Rate limiting (design D14–D19). Requires the seeded stack up on localhost.
 *
 * The default budgets (60/300 per minute) sit far above what a test issues, so
 * this suite pins its own low limits via `overrideProvider(APP_CONFIG)` — the
 * pattern `resilience.e2e-spec.ts` uses — leaving every other e2e suite's ambient
 * config untouched.
 *
 * The counter lives in shared Redis with a one-minute window, so requests from
 * one address would accumulate across tests and across reruns. Every test is
 * therefore given a UNIQUE client address via `X-Forwarded-For`, trusting one
 * proxy hop — which also exercises the real D16 path — so each starts from a
 * fresh bucket. A random base keeps reruns within the same window from colliding.
 */
// A random second octet per run keeps reruns within the same 60s window from
// colliding; the counter fills the last two octets. Every octet stays 0–255, so
// proxy-addr accepts the forwarded address instead of falling back to the socket.
const RUN_OCTET = Math.floor(Math.random() * 256);
let clientCounter = 0;
function freshClientIp(): string {
  clientCounter += 1;
  return `10.${RUN_OCTET}.${(clientCounter >> 8) & 255}.${clientCounter & 255}`;
}

async function bootApp(overrides: Record<string, string>): Promise<INestApplication> {
  const env = {
    ELASTICSEARCH_NODE: 'http://localhost:9200',
    REDIS_URL: 'redis://localhost:6379',
    // Trust one hop so the forwarded address becomes the client identity.
    TRUST_PROXY_HOPS: '1',
    ...overrides,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(buildConfig(validateEnv(env)))
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, app.get<AppConfiguration>(APP_CONFIG));
  await app.init();
  // Warm up so the Redis client is connected before any assertion. Until it is,
  // the fail-over store legitimately counts in memory (design D14) — correct
  // behaviour, but it would make an exact-count assertion racy. The warmup uses
  // its own client address so it consumes no budget under test.
  await request(app.getHttpServer()).get('/health').set('X-Forwarded-For', '10.255.255.254');
  await new Promise((resolve) => setTimeout(resolve, 300));
  return app;
}

describe('Rate limiting (e2e)', () => {
  describe('enforcement with a low search budget', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp({ RATE_LIMIT_SEARCH: '3', RATE_LIMIT_AUTOCOMPLETE: '3' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('serves up to the budget, then rejects with a typed 429 and Retry-After', async () => {
      // Arrange
      const server = app.getHttpServer();
      const ip = freshClientIp();

      // Act
      await request(server).get('/search?q=drill').set('X-Forwarded-For', ip).expect(200);
      await request(server).get('/search?q=drill').set('X-Forwarded-For', ip).expect(200);
      await request(server).get('/search?q=drill').set('X-Forwarded-For', ip).expect(200);
      const rejected = await request(server).get('/search?q=drill').set('X-Forwarded-For', ip);

      // Assert
      expect(rejected.status).toBe(429);
      expect(rejected.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
      expect(rejected.body).toHaveProperty('timestamp');
      expect(rejected.body).toHaveProperty('path');
      expect(rejected.headers['retry-after']).toBeDefined();
      expect(rejected.body.error).not.toMatch(/Throttler/);
    });

    it('advertises the shrinking budget through RateLimit-* headers', async () => {
      // Arrange
      const server = app.getHttpServer();
      const ip = freshClientIp();

      // Act
      const first = await request(server).get('/search?q=drill').set('X-Forwarded-For', ip);
      const second = await request(server).get('/search?q=drill').set('X-Forwarded-For', ip);

      // Assert
      expect(first.headers['ratelimit-limit']).toBe('3');
      expect(Number(first.headers['ratelimit-remaining'])).toBe(2);
      expect(Number(second.headers['ratelimit-remaining'])).toBe(1);
      expect(first.headers['ratelimit-reset']).toBeDefined();
    });

    it('counts each endpoint independently: exhausting search leaves autocomplete serving', async () => {
      // Arrange — burn the search budget for one client
      const server = app.getHttpServer();
      const ip = freshClientIp();
      for (let i = 0; i < 5; i += 1) {
        await request(server).get('/search?q=drill').set('X-Forwarded-For', ip);
      }

      // Act
      const autocomplete = await request(server)
        .get('/autocomplete?q=cor')
        .set('X-Forwarded-For', ip);

      // Assert
      expect(autocomplete.status).toBe(200);
    });

    it('gives distinct clients distinct budgets (D16)', async () => {
      // Arrange — client A exhausts its budget
      const server = app.getHttpServer();
      const clientA = freshClientIp();
      const clientB = freshClientIp();
      for (let i = 0; i < 4; i += 1) {
        await request(server).get('/search?q=drill').set('X-Forwarded-For', clientA);
      }

      // Act — a different forwarded address is a different bucket
      const other = await request(server).get('/search?q=drill').set('X-Forwarded-For', clientB);

      // Assert
      expect(other.status).toBe(200);
    });
  });

  describe('health exemption (D17)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp({ RATE_LIMIT_DEFAULT: '2', RATE_LIMIT_SEARCH: '2' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('never throttles the readiness probe', async () => {
      // Arrange
      const server = app.getHttpServer();
      const ip = freshClientIp();

      // Act — well past any configured limit, from one client
      const statuses: number[] = [];
      for (let i = 0; i < 8; i += 1) {
        const res = await request(server).get('/health').set('X-Forwarded-For', ip);
        statuses.push(res.status);
      }

      // Assert
      expect(statuses.every((status) => status === 200)).toBe(true);
    });
  });

  describe('enforcement switched off (D19)', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp({ RATE_LIMIT_ENABLED: 'false', RATE_LIMIT_SEARCH: '2' });
    });

    afterAll(async () => {
      await app.close();
    });

    it('lets a client exceed the otherwise configured limit', async () => {
      // Arrange
      const server = app.getHttpServer();
      const ip = freshClientIp();

      // Act
      const statuses: number[] = [];
      for (let i = 0; i < 5; i += 1) {
        const res = await request(server).get('/search?q=drill').set('X-Forwarded-For', ip);
        statuses.push(res.status);
      }

      // Assert — the 3rd would be a 429 with enforcement on
      expect(statuses.every((status) => status === 200)).toBe(true);
    });
  });
});
