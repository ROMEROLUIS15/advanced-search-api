# Tasks — add-request-rate-limiting

> Ordered by dependency: configuration first (everything reads it), then the port and its two adapters,
> then the guard that consumes them, then the edge wiring, then tests and docs. Each `[ ]` is verifiable on
> its own. References: `design.md` decisions **D14–D19**, `specs/request-rate-limiting/spec.md`.
> Commit one group at a time, conventional commits, never a mega-commit.

## 1. Dependency & configuration

- [x] 1.1 Add `@nestjs/throttler` to `dependencies` (official package; no third-party storage package — D15).
- [x] 1.2 Extend `env.schema.ts` with `RATE_LIMIT_ENABLED` (default `true`), `RATE_LIMIT_WINDOW_SECONDS` (default `60`), `RATE_LIMIT_SEARCH` (60), `RATE_LIMIT_AUTOCOMPLETE` (300), `RATE_LIMIT_SUGGEST` (60), `RATE_LIMIT_DEFAULT` (120) and `TRUST_PROXY_HOPS` (default `0`), all coerced and range-validated so an invalid value fails fast at boot.
- [x] 1.3 Map them in `app-config.ts` into a namespaced `RateLimitConfig` behind `APP_CONFIG`; add unit specs covering defaults, coercion and rejection of negative/non-numeric values.
- [x] 1.4 Document every new variable in `.env.example` with its local and Render value (`TRUST_PROXY_HOPS=1` in cloud).

## 2. Counter store port & adapters (D14)

- [x] 2.1 Define `RateLimitStorePort` + `RATE_LIMIT_STORE` `Symbol` token in `application/ports/`, exposing a single `hit(key, ttlSeconds)` returning the current count and the time left in the window. No Redis or Nest types in the signature.
- [x] 2.2 Implement `InMemoryRateLimitStore` in `infrastructure/` — a per-process map with expiry, used as the fallback and safe to use on its own.
- [x] 2.3 Implement `RedisRateLimitStore` using the existing `REDIS_CLIENT`: one pipelined `INCR` + `EXPIRE` per hit, keys namespaced and versioned like the cache keys.
- [x] 2.4 Implement the fail-over composition: try Redis, and on any Redis error log once and serve the hit from the in-memory store — never throw, never skip counting (D14).
- [x] 2.5 Unit-test all three: Redis path, in-memory path, and the fail-over path asserting that a Redis outage still increments and still enforces.

## 3. Guard & error mapping (D17, D18)

- [x] 3.1 Implement the throttler storage adapter bridging `@nestjs/throttler`'s storage contract to `RateLimitStorePort`.
- [x] 3.2 Configure per-endpoint budgets from `RateLimitConfig` and mark `GET /health` exempt.
- [x] 3.3 Resolve the client key from the request address, honouring the trusted-hop setting (D16).
- [x] 3.4 Map the throttler exception to **429** in `AllExceptionsFilter` with the project's standard error body; add a unit case next to the existing mapping specs.
- [x] 3.5 Emit `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` on limited responses and `Retry-After` on a 429.
- [x] 3.6 Honour `RATE_LIMIT_ENABLED=false` as a complete pass-through (D19).

## 4. Composition & edge wiring

- [x] 4.1 Create `rate-limit.module.ts` binding the port to the fail-over store and registering the guard globally; import it from `app.module.ts`.
- [x] 4.2 Set Express's proxy trust from `TRUST_PROXY_HOPS` in `app.setup.ts`, so `main.ts` and every e2e test exercise an identical edge.
- [x] 4.3 Declare `TRUST_PROXY_HOPS=1` in `render.yaml` — the deployed service sits behind the platform proxy, and without it every online client shares one bucket (D16).
- [x] 4.4 Verify no adapter is imported by a use-case and no Redis type crosses the port; keep every touched file under the 250-line cap.

## 5. Tests

- [x] 5.1 e2e: exhaust a limit and assert 429, the typed body, and `Retry-After`; pin low limits via `overrideProvider(APP_CONFIG)` as `resilience.e2e-spec.ts` does, so the rest of the suite is unaffected.
- [x] 5.2 e2e: assert `GET /health` is never throttled, and that exhausting `/search` leaves `/autocomplete` serving.
- [x] 5.3 e2e: assert `RateLimit-*` headers are present and that `RateLimit-Remaining` decreases.
- [x] 5.4 Confirm the existing e2e and integration suites still pass unmodified — no suite may start tripping the limiter.
- [x] 5.5 Run `npm run lint:ci`, `npm test`, `npm run build`, `npm run test:e2e`, `npm run test:integration` all green.

## 6. Load test & docs

- [ ] 6.1 Re-run the k6 battery with `RATE_LIMIT_ENABLED=false` to measure the limiter's overhead against the 2026-07-23 baseline, and record the delta.
- [ ] 6.2 Add a k6 scenario that drives past a limit and asserts the service answers 429 rather than degrading, and document why the capacity run disables enforcement.
- [ ] 6.3 Update `README.md`: the 429 in the error table, the new environment variables, and a short note on how a client should read the `RateLimit-*` headers.
- [ ] 6.4 Add a Postman request demonstrating the 429 with a saved response example.
- [ ] 6.5 Close audit finding F3 in `docs/AUDIT-2026-07-23.md` and update `CLAUDE.md` with the new guard, the port, and the `/health` exemption.
