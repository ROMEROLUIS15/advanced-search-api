import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, type AppConfiguration } from '../src/config/app-config';
import { REDIS_CLIENT } from '../src/infrastructure/redis/redis.client.factory';

/** Waits until the Redis client is connected so the readiness check is deterministic. */
async function waitForRedisReady(redis: Redis): Promise<void> {
  if (redis.status === 'ready') {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 3000);
    redis.once('ready', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/** e2e for `GET /health` against the running local stack (ES + Redis up). */
describe('GET /health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get<AppConfiguration>(APP_CONFIG));
    await app.init();
    await waitForRedisReady(app.get<Redis>(REDIS_CLIENT));
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports ok with both dependencies up', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(res.body.info.elasticsearch.status).toBe('up');
    expect(res.body.info.redis.status).toBe('up');
  });
});
