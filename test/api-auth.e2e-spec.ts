import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { APP_CONFIG, type AppConfiguration } from '../src/config/app-config';
import { loadConfig } from '../src/config/load-config';

const KEY = 'e2e-key-one';
const SECOND_KEY = 'e2e-key-two';

/**
 * The gate itself (design D30–D34). Every other e2e suite runs with
 * authentication off — they were written to exercise domain behaviour — so this
 * one turns it on through the config provider, the same way the resilience suite
 * pins its own environment.
 */
describe('API key authentication (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const config: AppConfiguration = {
      ...loadConfig(),
      apiAuth: { enabled: true, keys: [KEY, SECOND_KEY] },
    };
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(APP_CONFIG)
      .useValue(config)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app, config);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it.each(['/search?q=drill', '/autocomplete?q=dr', '/suggest?q=drll', '/'])(
    'rejects %s without a key',
    async (path) => {
      const res = await request(app.getHttpServer()).get(path).expect(401);

      expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
    },
  );

  it('rejects an unknown key without saying why', async () => {
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ q: 'drill' })
      .set('X-API-Key', 'wrong-key-guess')
      .expect(401);

    expect(JSON.stringify(res.body)).not.toContain('wrong-key-guess');
  });

  it('serves a request carrying a configured key', async () => {
    const res = await request(app.getHttpServer())
      .get('/search')
      .query({ q: 'drill' })
      .set('X-API-Key', KEY)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('accepts the second key too, which is what makes rotation possible', async () => {
    await request(app.getHttpServer())
      .get('/search')
      .query({ q: 'drill' })
      .set('X-API-Key', SECOND_KEY)
      .expect(200);
  });

  it('leaves /health open — the platform probe cannot send a header', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
  });

  it.each(['/health/ready', '/health/live'])(
    'leaves %s open too: a 401 on the polled path would fail every deploy',
    async (path) => {
      // Render polls readiness with no credential and reads any non-200 as an
      // unhealthy instance, so this is a deployment guarantee, not a nicety.
      const res = await request(app.getHttpServer()).get(path).expect(200);

      expect(res.body.status).toBe('ok');
    },
  );

  it('does not mount the contract in an e2e boot', async () => {
    // /docs is Express middleware mounted by setupOpenApi, which e2e boots do
    // not call — the protection is asserted in swagger.setup.spec.ts instead.
    await request(app.getHttpServer()).get('/docs-json').expect(404);
  });

  it('still carries a correlation id on the rejection', async () => {
    const res = await request(app.getHttpServer()).get('/search').expect(401);

    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('counts the rejected request in the metrics, which the interceptor never saw', async () => {
    // The recording middleware runs ahead of the guards; a 401 rejected by the
    // API-key guard must still land in the registry under its matched route.
    await request(app.getHttpServer()).get('/search').query({ q: 'drill' }).expect(401);

    const res = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(res.text).toMatch(
      /http_requests_total\{method="GET",route="\/search",status="401"\} [1-9]/,
    );
  });
});
