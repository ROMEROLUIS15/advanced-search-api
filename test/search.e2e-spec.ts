import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/presentation/common/all-exceptions.filter';

/**
 * Happy-path e2e for the vertical slice (task 6.6). Runs against the local
 * Elasticsearch seeded via `npm run seed` (docker-compose stack up).
 */
describe('GET /search (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
    );
    app.useGlobalFilters(new AllExceptionsFilter());
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
