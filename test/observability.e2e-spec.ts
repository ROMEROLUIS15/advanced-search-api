import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, type AppConfiguration } from '../src/config/app-config';

/**
 * Correlation id through the real pipeline (design D22). Deliberately exercised
 * against `GET /`, which is static metadata: the assertions are about the edge,
 * not about the seeded dataset, so this suite stays meaningful even when the
 * index is empty.
 */
describe('Observability (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app, app.get<AppConfiguration>(APP_CONFIG));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns a generated correlation id when the client sends none', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);

    expect(res.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('echoes an inbound correlation id unchanged', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .set('X-Request-Id', 'client-supplied-42')
      .expect(200);

    expect(res.headers['x-request-id']).toBe('client-supplied-42');
  });

  it('replaces an unsafe inbound id instead of reflecting it into the response', async () => {
    const res = await request(app.getHttpServer())
      .get('/')
      .set('X-Request-Id', 'not a valid id')
      .expect(200);

    expect(res.headers['x-request-id']).not.toBe('not a valid id');
  });

  it('carries a correlation id on error responses too', async () => {
    const res = await request(app.getHttpServer()).get('/search').query({ bogus: 'x' }).expect(400);

    expect(res.headers['x-request-id']).toBeDefined();
  });
});
