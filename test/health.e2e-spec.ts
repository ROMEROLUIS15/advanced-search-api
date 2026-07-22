import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Redis } from 'ioredis';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/presentation/common/all-exceptions.filter';
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
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
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
