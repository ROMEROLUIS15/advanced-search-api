import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';

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
  });

  it('rejects unknown query parameters with 400', async () => {
    await request(app.getHttpServer()).get('/search').query({ bogus: 'x' }).expect(400);
  });
});
