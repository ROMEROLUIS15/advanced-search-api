import request from 'supertest';

/**
 * The combination nobody exercised: the real `dist/main.js`, booted the way
 * Render boots it, with authentication **and** rate limiting on, Swagger
 * mounted, and log shipping configured.
 *
 * Every other suite deliberately runs with the gate off — they test domain
 * behaviour — and the DAST job turns both off so ZAP can reach the application
 * surface. Both choices are right on their own and left one thing untested: the
 * pieces together. The cost of that gap is on record. Log shipping was switched
 * on in production and silenced the service instead, because no suite had ever
 * started the pino transport worker (`7ee3757`).
 *
 * This suite talks to an already-running server over HTTP rather than booting
 * Nest in-process. That is the point: `configureApp` is what the e2e suites
 * already cover, and what is missing is everything `main.ts` adds around it —
 * the logger, the OpenAPI mount, the import order, the process safety net.
 */
const baseUrl = process.env.SMOKE_BASE_URL ?? 'http://localhost:3000';
const apiKey = process.env.SMOKE_API_KEY ?? '';

const api = (): request.Agent => request(baseUrl);

describe('production shape — the health family stays open', () => {
  it.each(['/health', '/health/ready', '/health/live'])(
    'serves %s with no credential, as the platform must be able to',
    async (path) => {
      const res = await api().get(path).expect(200);

      expect(res.body.status).toBe('ok');
    },
  );
});

describe('production shape — the gate is on', () => {
  it('rejects a client endpoint with no key', async () => {
    const res = await api().get('/search').query({ q: 'drill' }).expect(401);

    expect(res.body).toMatchObject({ statusCode: 401 });
  });

  it('serves the same endpoint with a valid key', async () => {
    const res = await api()
      .get('/search')
      .query({ q: 'drill' })
      .set('X-API-Key', apiKey)
      .expect(200);

    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

describe('production shape — the published contract is guarded', () => {
  // Swagger mounts straight onto Express, so no Nest guard ever runs for it;
  // the protection is a middleware in swagger.setup.ts. Nothing but this suite
  // exercises it, because e2e boots never call setupOpenApi at all.
  it('refuses the OpenAPI document without a key', async () => {
    await api().get('/docs-json').expect(401);
  });

  it('serves the OpenAPI document with a key, and it describes the API', async () => {
    const res = await api().get('/docs-json').set('X-API-Key', apiKey).expect(200);

    expect(res.body.paths['/search']).toBeDefined();
    // /metrics carries @ApiExcludeEndpoint, so it must not be in the contract.
    expect(res.body.paths['/metrics']).toBeUndefined();
  });

  // Last in this block on purpose: it spends the address's docs budget, and the
  // 401 case above needs that budget intact to get a 401 rather than a 429.
  it('meters unauthenticated attempts instead of rejecting them for free', async () => {
    // Before this, the contract was the one surface where keys could be tried as
    // fast as the network allowed: SwaggerModule mounts it straight onto
    // Express, so the global guard never sees it.
    let throttled: request.Response | undefined;
    for (let attempt = 0; attempt < 20 && throttled === undefined; attempt += 1) {
      const res = await api().get('/docs-json');
      if (res.status === 429) {
        throttled = res;
      }
    }

    expect(throttled).toBeDefined();
    expect(throttled?.body).toMatchObject({ statusCode: 429, error: 'Too Many Requests' });
    expect(throttled?.headers['retry-after']).toBeDefined();
  });

  it('still serves a valid key from an address whose budget is spent', async () => {
    // Buckets are per-identity: a flood from one address must not lock out a
    // legitimate key holder behind the same NAT.
    await api().get('/docs-json').set('X-API-Key', apiKey).expect(200);
  });
});

describe('production shape — the limiter is on', () => {
  it('advertises the remaining budget under the RateLimit-* prefix', async () => {
    // `/suggest` keeps its own bucket, so this does not depend on whatever the
    // burst below has spent. The prefix is a deliberate override: the library's
    // own default is X-RateLimit-*, and a client reading the standard names
    // would see nothing if that override were ever dropped.
    const res = await api().get('/suggest').query({ q: 'drll' }).set('X-API-Key', apiKey);

    expect(res.status).toBe(200);
    expect(res.headers['ratelimit-limit']).toBeDefined();
    expect(res.headers['ratelimit-remaining']).toBeDefined();
    expect(res.headers['x-ratelimit-limit']).toBeUndefined();
  });

  it('answers 429 with Retry-After once the budget is spent', async () => {
    // The budget is set low for this run, so a short burst is enough. Bucketing
    // is by a digest of the valid key, so every request here shares one bucket.
    let throttled: request.Response | undefined;
    for (let attempt = 0; attempt < 40 && throttled === undefined; attempt += 1) {
      const res = await api().get('/search').query({ q: 'drill' }).set('X-API-Key', apiKey);
      if (res.status === 429) {
        throttled = res;
      }
    }

    expect(throttled).toBeDefined();
    expect(throttled?.body).toMatchObject({ statusCode: 429 });
    // Measured: the throttled response carries Retry-After and **no**
    // RateLimit-* headers — those ride the success path only, since the guard
    // throws before the budget headers are written.
    expect(throttled?.headers['retry-after']).toBeDefined();
  });

  it('never throttles the readiness path, however hard the platform polls it', async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      await api().get('/health/ready').expect(200);
    }
  });
});
