import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, type AppConfiguration } from '../src/config/app-config';

/** e2e for `GET /autocomplete` against the seeded local Elasticsearch. */
describe('GET /autocomplete (e2e)', () => {
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

  it('returns type-ahead completions for a prefix', async () => {
    const res = await request(app.getHttpServer())
      .get('/autocomplete')
      .query({ q: 'cord' })
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const texts = res.body.data.map((item: { text: string }) => item.text.toLowerCase());
    expect(texts.some((text: string) => text.includes('cordless'))).toBe(true);
  });

  it('honors the limit parameter', async () => {
    const res = await request(app.getHttpServer())
      .get('/autocomplete')
      .query({ q: 'd', limit: 2 })
      .expect(200);

    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it('rejects a missing q with 400', async () => {
    await request(app.getHttpServer()).get('/autocomplete').expect(400);
  });

  it('rejects a limit above 20 with 400', async () => {
    await request(app.getHttpServer())
      .get('/autocomplete')
      .query({ q: 'd', limit: 50 })
      .expect(400);
  });
});
