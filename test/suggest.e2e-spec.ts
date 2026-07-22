import { type INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/presentation/common/all-exceptions.filter';

/** e2e for `GET /suggest` against the seeded local Elasticsearch. */
describe('GET /suggest (e2e)', () => {
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

  it('returns a "did you mean" correction for a typo', async () => {
    const res = await request(app.getHttpServer())
      .get('/suggest')
      .query({ q: 'driil' })
      .expect(200);

    expect(res.body.data).toHaveProperty('didYouMean');
    expect(res.body.data).toHaveProperty('related');
    expect(typeof res.body.data.didYouMean).toBe('string');
    expect(res.body.data.didYouMean).toContain('drill');
  });

  it('rejects a missing q with 400', async () => {
    await request(app.getHttpServer()).get('/suggest').expect(400);
  });
});
