import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, type AppConfiguration } from '../src/config/app-config';

/**
 * Happy-path e2e for the vertical slice (task 6.6). Runs against the local
 * Elasticsearch seeded via `npm run seed` (docker-compose stack up).
 */
describe('GET /search (e2e)', () => {
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

  it('returns relevance-ranked hits with pagination metadata', async () => {
    const res = await request(app.getHttpServer()).get('/search').query({ q: 'drill' }).expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta).toMatchObject({
      page: 1,
      pageSize: 20,
      sort: 'relevance',
      order: 'desc',
    });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);

    const names = res.body.data.map((product: { name: string }) => product.name.toLowerCase());
    expect(names.some((name: string) => name.includes('drill'))).toBe(true);
  });

  it('browses with default popularity sort when q is absent', async () => {
    const res = await request(app.getHttpServer()).get('/search').expect(200);

    expect(res.body.meta.sort).toBe('popularity');
    expect(res.body.data.length).toBeGreaterThan(0);

    // Facets are computed over the query universe (design D4).
    expect(res.body.facets.priceRanges).toHaveLength(4);
    expect(res.body.facets.categories.length).toBeGreaterThan(0);
    const tools = res.body.facets.categories.find(
      (bucket: { key: string }) => bucket.key === 'Tools',
    );
    expect(tools.count).toBeGreaterThanOrEqual(1);
  });

  it('narrows hits by category while keeping the category facet full (exclude own dimension, D4)', async () => {
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ category: 'Tools' })
      .expect(200);

    // Every hit is in Tools...
    expect(
      res.body.data.every((product: { category: string }) => product.category === 'Tools'),
    ).toBe(true);
    // ...but the categories facet still shows other categories, so it can be widened.
    const keys = res.body.facets.categories.map((bucket: { key: string }) => bucket.key);
    expect(keys).toContain('Tools');
    expect(keys.length).toBeGreaterThan(1);
  });

  it('rejects unknown query parameters with 400', async () => {
    await request(app.getHttpServer()).get('/search').query({ bogus: 'x' }).expect(400);
  });

  it('applies security headers via Helmet', async () => {
    const res = await request(app.getHttpServer()).get('/search').query({ q: 'drill' }).expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('rejects a pageSize above the configured maximum with 400', async () => {
    await request(app.getHttpServer()).get('/search').query({ pageSize: 500 }).expect(400);
  });

  it('rejects a result window beyond max_result_window with 422', async () => {
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ page: 100000, pageSize: 100 })
      .expect(422);
    expect(res.body).toMatchObject({ statusCode: 422, error: 'Unprocessable Entity' });
  });

  it('rejects an over-long q with 400 instead of letting Elasticsearch answer 502', async () => {
    // Measured against the deployment before the length caps existed: a single
    // token of 3000 characters made Lucene's fuzzy automaton too complex, so
    // Elasticsearch rejected it and the client saw a 502 for its own bad input.
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ q: 'a'.repeat(3000) })
      .expect(400);

    expect(res.body).toMatchObject({ statusCode: 400, message: 'Validation failed' });
    expect(res.body.details.join(' ')).toMatch(/q must be shorter than/i);
  });

  it('rejects an inverted price range with 400 instead of an empty 200', async () => {
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ minPrice: 500, maxPrice: 10 })
      .expect(400);

    expect(res.body.details.join(' ')).toMatch(
      /maxPrice must be greater than or equal to minPrice/,
    );
  });

  it('declares the cache policy it actually applies', async () => {
    const res = await request(app.getHttpServer()).get('/search').query({ q: 'drill' }).expect(200);

    // Never `public`: the endpoint needs an API key, so a shared cache holding
    // the response would hand it to a caller that never presented one.
    expect(res.headers['cache-control']).toMatch(/^private, max-age=\d+$/);
    expect(res.headers['vary']).toBe('x-api-key');
  });

  it('paginates without duplicating or skipping documents across pages', async () => {
    const pageSize = 10;
    const ids: string[] = [];
    for (const page of [1, 2, 3]) {
      const res = await request(app.getHttpServer())
        .get('/search')
        .query({ sort: 'popularity', order: 'desc', page, pageSize })
        .expect(200);
      ids.push(...res.body.data.map((product: { id: string }) => product.id));
    }
    expect(ids).toHaveLength(24);
    expect(new Set(ids).size).toBe(24);
  });
});
