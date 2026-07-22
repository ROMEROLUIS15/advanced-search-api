import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, buildConfig, type AppConfiguration } from '../src/config/app-config';
import { validateEnv } from '../src/config/env.schema';

async function bootApp(env: Record<string, string>): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(buildConfig(validateEnv(env)))
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app, app.get<AppConfiguration>(APP_CONFIG));
  await app.init();
  return app;
}

describe('Resilience (e2e)', () => {
  describe('search engine unreachable', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp({
        ELASTICSEARCH_NODE: 'http://localhost:9201', // nothing listening
        REDIS_URL: 'redis://localhost:6379',
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('returns 503 when Elasticsearch is unreachable', async () => {
      const res = await request(app.getHttpServer())
        .get('/search')
        .query({ q: 'drill' })
        .expect(503);
      expect(res.body).toMatchObject({ statusCode: 503, error: 'Service Unavailable' });
    }, 20000);
  });

  describe('cache unavailable', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await bootApp({
        ELASTICSEARCH_NODE: 'http://localhost:9200',
        REDIS_URL: 'redis://localhost:6390', // nothing listening
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('still returns 200 from Elasticsearch when Redis is down (fail-open)', async () => {
      const res = await request(app.getHttpServer())
        .get('/search')
        .query({ q: 'drill' })
        .expect(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });
  });
});
