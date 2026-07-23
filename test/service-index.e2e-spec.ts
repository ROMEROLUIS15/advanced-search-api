import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, type AppConfiguration } from '../src/config/app-config';

/** e2e for `GET /`: the landing route must answer instead of falling through to 404. */
describe('GET / (e2e)', () => {
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

  it('describes the service and its endpoints', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);

    expect(res.body.name).toBe('Advanced Product Search API');
    expect(Object.keys(res.body.endpoints)).toEqual([
      'GET /search',
      'GET /autocomplete',
      'GET /suggest',
      'GET /health',
    ]);
  });

  it('still 404s for a route that does not exist', async () => {
    const res = await request(app.getHttpServer()).get('/nope').expect(404);

    expect(res.body.statusCode).toBe(404);
    expect(res.body.path).toBe('/nope');
  });
});
