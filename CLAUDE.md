# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Advanced Product Search API** — NestJS + TypeScript over Elasticsearch (relevance, filtering, faceting,
suggestions) and Redis (fail-open cache), in a strict hexagonal architecture. Read-only over a single seeded
index. Endpoints: `GET /`, `GET /search`, `GET /autocomplete`, `GET /suggest`, `GET /health` (contract and env
table documented in `README.md`).

The system is **implemented and deployed**, live at <https://advanced-search-api-chet.onrender.com> (Render,
Docker runtime built from `render.yaml`). **The API is private**: every endpoint except `/health` requires an
`X-API-Key` header (`/metrics` takes its own bearer token instead).

Code comments cite design decisions by ID (`design D4`); the rationale is spread across **six** archived
changes under `openspec/changes/archive/`, not one — `2026-07-22-advanced-search-system` holds **D1–D13** (the
core system), `2026-07-23-add-request-rate-limiting` **D14–D19**, `2026-07-27-add-service-observability`
**D21–D29**, `2026-07-27-add-api-client-authentication` **D30–D34**,
`2026-07-28-ship-metrics-and-logs-to-grafana` **D35–D38** (telemetry shipping), and
`2026-07-28-split-health-liveness-and-readiness` **D39–D42** (the health endpoint split). The one exception
is **D20** (ES `requestTimeout`/`maxRetries`), which has no `design.md` entry — its rationale is in README
"Trade-offs" only. Each change's delta specs were synced into `openspec/specs/` on archiving, **ten
capabilities** in total, and those scenarios are the acceptance criteria.

Post-ship reports live under `docs/`: the 2026-07-23 audit, the load-test run, the 2026-07-25 hardening report,
the 2026-07-26 QA review, the 2026-07-27 observability report, the 2026-07-27 auth rollout — and
**`PENDING-2026-07-28.md`, the one to read first**: a verified handoff of everything still open, with a
recommended order and the measurement traps already fallen into once.

## Commands

```bash
npm run start:dev            # ts-node-dev watch mode on :3000 (needs ES + Redis reachable)
npm run build                # nest build + tsc-alias (rewrites @-aliases in dist/)
npm start                    # node dist/main.js
npm run seed                 # provision index + alias, bulk-load src/seed/dataset/products.seed.json (idempotent)
npm run seed:prod            # same seed from dist/ — the only form that works in Docker/Render (no ts-node there)
npm run lint                 # eslint --fix over {src,test}
npm run lint:ci              # same rules WITHOUT --fix — what CI runs (see below)
npm test                     # unit specs (src/**/*.spec.ts) — mocked ports, NO infrastructure needed
npm run test:e2e             # test/*.e2e-spec.ts — REQUIRES the stack up AND seeded
npm run test:integration     # test/*.integration-spec.ts — REQUIRES a real Elasticsearch
npm run test:cov             # unit specs with coverage (writes coverage/)
npm run loadtest             # k6 capacity battery (loadtest/battery.js) — enforcement OFF; needs k6 installed
npm run loadtest:smoke       # k6 smoke run (loadtest/smoke.js)
npm run loadtest:report      # render loadtest/results/*.json into loadtest/results/REPORT.md
```

`loadtest/rate-limit.js` is run directly (`k6 run loadtest/rate-limit.js`), not via an npm script — it is the
correctness run that floods one client and asserts 429 (see the rate-limiting note below). The whole harness is
plain JS **outside `src/`**: no npm dependency, not in the TS build, and ESLint only globs `{src,test}/**/*.ts`,
so nothing under `loadtest/` is linted or type-checked — a broken scenario surfaces only when k6 runs it.

Single test: `npx jest src/path/to/file.spec.ts`, or by name `npm test -- -t "excludes its own dimension"`.
Single e2e: `npx jest --config ./test/jest-e2e.json test/search.e2e-spec.ts`.
Single integration: `npx jest --config ./test/jest-integration.json test/elasticsearch.integration-spec.ts`.

`npm run lint:ci && npm run test:cov && npm run build` is the `quality` CI job reproduced locally — run it
before calling work done. Green baseline as of 2026-07-28: **70 suites / 463 tests**, plus 9 e2e suites
(45 tests) and 5 integration tests against the real stack.

`test:cov` **is** the gate: `coverageThreshold` sits just under the measured baseline (98 % statements, 92 %
branches, 97 % functions) and CI's `quality` job runs `test:cov` instead of `npm test` — same suite, one more
verdict. Note what the number covers: `collectCoverageFrom` drops `main.ts`, `**/*.module.ts`, `**/dto/**`,
`*.client.factory.ts`, `*-client.lifecycle.ts` and `seed/**`, so it is business logic only.

`npm run format` is redundant — Prettier runs as an ESLint rule (`eslint-plugin-prettier/recommended`) over the
same file set, so `npm run lint` already formats. Lint is **type-aware** (`recommendedTypeChecked` +
`projectService`): a new file outside the tsconfig project fails to lint at all.

**Never point CI at `npm run lint`** — it carries `--fix`, so an auto-fixable violation gets repaired in the
runner's working copy and the job reports success while the offending code stays in the repo (measured: a
badly formatted file exits 0 under `lint`, 1 under `lint:ci`). `.github/workflows/ci.yml` runs `lint:ci`, and
splits into two independent jobs — `quality` (lint, unit, build) and `integration` (compose up ES + Redis,
seed, then `test:integration` and `test:e2e`) — so a lint failure cannot mask an e2e failure.

**Security scanning** rides alongside CI in four layers (all free, public-repo): `codeql.yml` — SAST over the
TS; `dependabot.yml` — SCA (npm + github-actions + docker); `security.yml` — `secrets` (gitleaks over full
history, blocking) and `dast` (OWASP ZAP against the API booted on the runner as Render does — `build` +
`seed:prod` + `node dist/main.js`, never `start:dev`). **api-scan, not baseline**: the passive baseline spider
follows HTML links, so on a JSON API it only ever reached `/` (3 URLs); `zap-api-scan.py` imports the OpenAPI at
`/docs-json` and hits every endpoint with its params (SQLi/XSS/command-injection/SSTI/Log4Shell exercised
against `q` & co.). `RATE_LIMIT_ENABLED=false` so ZAP doesn't scan its own 429s; design-decision false positives
(CSP off, the ISO `timestamp`) are silenced in `.zap/rules.tsv` (set to IGNORE so they don't count); the scan is
**blocking** (no `-I`) — a WARN or FAIL fails the job, measured 0/0 over 128 URLs. On Linux runners the ZAP
container uses `--network host` + `localhost`; on Docker Desktop (local)
it's `host.docker.internal` instead.

A fifth workflow, `keep-alive.yml`, is **not** CI — and since 2026-07-28 it is **not the keep-alive either,
only a backstop**. Measured over its full run history: GitHub honours its `*/10` schedule roughly once an
hour with gaps up to 8h48, and the ticks are never created (no queued or cancelled runs), so the instance was
napping ten times a day while every run stayed green — the job's curl rides out the very cold start it was
meant to prevent. What actually keeps the free instance awake is an **external UptimeRobot monitor** on
`/health` every 5 minutes, which also owns the uptime-alarm role (email on non-200). **`/health` and nothing
else** — it is the one endpoint the rate limiter skips *and* the API-key guard leaves open. Aimed at `/`
instead (the mistake made on day one) every check answers **401**, so the monitor reports a permanent
outage and emails about it, while still keeping the instance awake — a 401 is inbound traffic like any
other, which is what makes the misconfiguration survivable and therefore easy to leave in place. The quota decision stands: free-tier Render bills 750 instance-hours a month *across the
workspace* and staying awake costs ~730, so the monitor's cadence and a second free service cannot coexist —
over quota, Render suspends services. The workflow stays as an hourly-ish independent probe (`permissions:
contents: read`, fails on non-200); GitHub auto-disables schedules after 60 days of repo inactivity, so
check the Actions tab if the backstop goes quiet.

**Dependency policy** (SCA-driven): `npm audit` is kept at **0** (dev + prod) via two targeted `overrides` in
`package.json` — `js-yaml` → `5.2.2` (its DoS advisory reached prod through `@nestjs/swagger`) and
`brace-expansion` → `5.0.8` (a DoS advisory transitive through the jest/eslint tooling). Two majors are pinned
on purpose, not neglect, and ignored/kept accordingly: **`@elastic/elasticsearch` stays on 8.x** to match the
8.17 server (ignored in `dependabot.yml`), and **TypeScript stays on 5.x** — TS 7.0 ships without the
programmatic compiler API `nest build`/`ts-jest`/`typescript-eslint` need (returns in 7.1), and TS 6 deprecates
`baseUrl` + `moduleResolution=node10`, whose migration touches resolution entangled with
`tsc-alias`/`tsconfig-paths`. zod 4, eslint 10 and the node 26 base image are current.

`test:e2e` / `test:integration` run `--runInBand` deliberately: every e2e suite talks to the *same* external
index and Redis, and in parallel workers the run ends with "a worker process has failed to exit gracefully".
Serially all suites pass and Jest exits on its own, so neither script needs `--forceExit`.

Stack up: `docker compose up -d elasticsearch redis` (deps only, then run the API locally), or
`docker compose up -d --build` (adds the API) plus `docker compose --profile seed run --rm seed` for a one-shot seed.

`api.http` is the no-import twin of `postman/` (VS Code REST Client / JetBrains). Its `@baseUrl` defaults to the
**deployed** service, not localhost — clicking Send hits production and spends real rate-limit budget; the
localhost line right below it is commented out.

**e2e/integration are not hermetic.** They boot the real `AppModule` against `localhost:9200` / `localhost:6379`
and assert on the seeded dataset (e.g. 24 products across three pages, a `Tools` category, hits for `drill`).
Seed before running them, and re-seed after changing `products.seed.json` or an assertion count will drift.
`test/resilience.e2e-spec.ts` additionally requires that **nothing** is listening on ports `9201` and `6390` —
that is how it provokes the 503 and the cache fail-open paths.

They also read the **ambient `.env`** (only `resilience.e2e-spec.ts` pins its own env via
`overrideProvider(APP_CONFIG)`). Pointing `.env` at the managed services therefore silently redirects the whole
e2e run at cloud — and `health.e2e-spec.ts`, which asserts `redis.status === 'up'`, fails if that Redis is not
reachable. Keep `.env` on `localhost` for local runs and set cloud values on the deploy host instead.

## Architecture

Four layers under `src/`, dependencies inward only (each layer has its own `README.md` restating its rule):

```
domain  →  application (use-cases + ports)  →  infrastructure (ES/Redis adapters)
                                            →  presentation (controllers + DTOs)
```

Composition is by **feature module** at the root: `search.module.ts`, `autocomplete.module.ts`,
`suggestion.module.ts`, `health.module.ts` each import `ElasticsearchModule` + `RedisModule`, provide their
use-case, and register their controller. `service-index.module.ts` is the exception — `GET /` is static
metadata, so it registers a controller and nothing else. `app.module.ts` only assembles those plus the global
`AppConfigModule`.

- **DI is exclusively via `Symbol` tokens.** Every port is `interface` + token
  (`PRODUCT_SEARCH_PORT`, `AUTOCOMPLETE_PORT`, `QUERY_SUGGESTION_PORT`, `PRODUCT_INDEX_PORT`, `CACHE_PORT`,
  `HEALTH_PROBE`, `RATE_LIMIT_STORE`, `METRICS_PORT`, `METRICS_EXPORTER`, plus `APP_CONFIG`,
  `ELASTICSEARCH_CLIENT`, `REDIS_CLIENT`). Use-cases `@Inject(TOKEN)` and
  never import an adapter class. Adapter bindings (`{ provide: TOKEN, useClass: Adapter }`) live in
  `infrastructure/*/{elasticsearch,redis}.module.ts` — with exactly **two** deliberate exceptions outside
  `infrastructure/`, both `useFactory` rather than `useClass`: `APP_CONFIG` in `config/config.module.ts`
  (a `@Global` module) and `HEALTH_PROBE` in `health.module.ts` (an array of the two probe classes). Grep for
  `provide:` before assuming a token is bound where you expect.
- **Ports never leak ES/Redis types.** The currency across the boundary is `SearchCriteria`, `SearchOutcome`,
  `Facets`, `ProductSummary`, `QuerySuggestion`, `HealthReport` (in `application/models/`). `estypes` imports
  are confined to `infrastructure/elasticsearch/`, and `application/` + `domain/` import neither
  `@elastic/elasticsearch` nor `ioredis` at all. The one file outside `infrastructure/` that touches the ES
  package is `presentation/common/all-exceptions.filter.ts`, which imports the runtime `errors` namespace
  (not `estypes`) because centralized status mapping needs `instanceof esErrors.ResponseError`.
- **`app.setup.ts` holds the whole HTTP pipeline** (Helmet with CSP off, env-aware CORS, global
  `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`, `LoggingInterceptor`, `AllExceptionsFilter`,
  shutdown hooks) so `main.ts` and every e2e test exercise the identical edge. Add global edge behavior there,
  not in `main.ts`. Two things live in `main.ts` **on purpose, not** in `configureApp`: `installProcessSafetyNet`
  and `setupOpenApi` (`src/swagger.setup.ts`) — neither is part of the security edge the e2e suites must
  exercise, and a per-boot listener/doc route in every e2e app would be waste. OpenAPI is published at `/docs`
  (UI) and `/docs-json` (the spec the DAST job feeds ZAP); the `@nestjs/swagger` CLI plugin in `nest-cli.json`
  derives the **query** param schema from the `class-validator` DTOs, so those carry no `@ApiProperty`.
  **Response** DTOs are the opposite: they are classes with explicit `@ApiProperty` (the plugin only ever
  emitted `type: object` for them), and every endpoint declares its statuses — `@ApiOkResponse` plus
  `ApiErrorResponses(...)`, which renders the shared `ErrorResponseDto`. The plugin
  runs during `nest build`, **not** under `start:dev`'s `--transpile-only`, so the full spec exists in `dist/`
  but not in watch mode.
- **Path aliases** `@domain/* @application/* @infrastructure/* @presentation/* @config/* @shared/*` are declared
  in **four files** that must stay in sync: `tsconfig.json` `paths`, `package.json` `jest.moduleNameMapper`,
  `test/jest-e2e.json` and `test/jest-integration.json`. `dist` resolution depends on `tsc-alias` running as
  part of `npm run build`.

## The non-obvious parts

- **`start:dev` does not type-check.** It runs `ts-node-dev --transpile-only`, so code with type errors boots
  happily. `tsconfig.json` is `strict` **plus** `noImplicitReturns` / `noUnusedLocals` / `noUnusedParameters`,
  so a single unused import or parameter is a hard `TS6133` in `npm run build` and in `npm test` (ts-jest
  reports diagnostics for specs too). Note `tsconfig.build.json` excludes `test/` and `**/*.spec.ts` — the
  build alone never type-checks the specs, `npm test` is what covers them. Run both before calling work done.
- **The seed is a second composition root.** `src/seed/seed.command.ts` boots a Nest *standalone context* over
  `SeedModule` (not `AppModule`), so it has no HTTP pipeline. `loadProducts()` collects invalid records with a
  reason instead of throwing — a bad row is warned and skipped, and the process ends with `exitCode = 1` rather
  than aborting the batch. The dataset reaches `dist/` through `nest-cli.json` `assets: ["seed/dataset/*.json"]`
  (not tsc): a fixture added outside that glob compiles fine and then fails only at runtime in the container.
  The runtime image is `npm ci --omit=dev`, so ts-node does not exist there — Docker/Render seed with
  `npm run seed:prod` (`node dist/seed/seed.command.js`), never `npm run seed`.
- **One Elasticsearch round-trip per `/search`.** `search-query.builder.ts` assembles hits + aggregations +
  suggest into a single request body; the adapter issues exactly one `client.search`. Never split it.
- **Faceting is the highest-risk logic (D4).** Filters go in **`post_filter`** so they constrain the *hits*
  while the aggregation universe stays "everything matching the text query". Each facet is a `filter`
  sub-aggregation applying all other selected filters **except its own dimension** — that is what lets a user
  widen a dimension they already narrowed (`buildFilterClauses(filters, dimension)` in
  `facet-aggregations.builder.ts`, table-driven specs in `filter.builder.spec.ts` /
  `facet-aggregations.builder.spec.ts`). Changing this needs both the unit table and the D4 e2e case updated.
- **Relevance (D3)**: `multi_match` (BM25 + field boosts + `fuzziness: AUTO` + `minimum_should_match`) wrapped
  in `function_score` (popularity `field_value_factor`, recency `gauss`, `boost_mode: multiply`). Empty `q` ⇒
  `match_all` browse mode defaulting to popularity sort. Weights/scale come from `RelevanceConfig` (env-tunable).
- **The query builder is deliberately four files** — `text-query`, `filter`, `facet-aggregations`, `sort` —
  composed by `search-query.builder.ts`. Keep new query concerns in their own builder.
- **Cache is strictly cache-aside and fail-open (D8).** All of it lives in `application/caching/cache-aside.ts`:
  a cache error is logged and treated as a miss; only `load()` errors propagate. Reuse that helper rather than
  touching `CachePort` from a use-case. Keys are `search:v1:<scope>:<sha1>` over *normalized* criteria — the
  `scope` segment (`cache-scope.ts`) digests the index name **plus** the relevance config, so a reindex or a
  ranking tune misses naturally instead of serving the previous deployment's results; bump `v1` by hand only
  when the payload *shape* changes. Autocomplete keys are `ac:v1:<scope>:<sha1(prefix)>:<limit>` — the user's
  prefix is hashed, never stored in clear, and that scope deliberately digests the index only (relevance does
  not shape prefix hits, so a tune must not flush the whole prefix cache). Three things happen there that surprise people
  (D26/D27): concurrent misses for one key **share a single `load()`**, the stored TTL carries **±10 % jitter**,
  and a hit is **parsed against a zod schema** (`cached-payload.schema.ts`) — so a cache hit is a validated
  *copy*, not the object that was stored, and a payload of the wrong shape is treated as a miss.
- **Index behind an alias (D1)**: physical `products_v1` read/written through the `products` alias;
  `ensureIndex()` is idempotent. The mapping intentionally sets **no** `number_of_shards`/`number_of_replicas`
  (Elastic Cloud Serverless rejects them).
- **ES client resilience (D20)**: the client factory sets an explicit `requestTimeout` (4 s) and `maxRetries`
  (2) from `ELASTICSEARCH_REQUEST_TIMEOUT_MS`/`ELASTICSEARCH_MAX_RETRIES`, overriding the SDK's 30 s / 3
  defaults — a tight timeout is the main lever keeping a *slow* ES from draining the pool, and fewer retries
  avoid amplifying load on a single ailing node. A circuit breaker is deliberately **not** added (single data
  source ⇒ fail fast to 503 + `/health` is the right level); the rationale lives in README "Trade-offs".
- **Error mapping is centralized** in `AllExceptionsFilter`: `ResultWindowExceededError` → **422**,
  domain/application errors → **400**, ES `ResponseError` → **400 when the engine itself answered 400** (a
  query built from bad input, not a broken cluster) and **502** otherwise, ES `ElasticsearchClientError` →
  **503**, anything else → 500. Throw typed errors; don't map status codes in controllers or adapters. The
  `HttpException` branch is checked **first**, ahead of every typed branch, so any Nest exception (a validation
  400, the guard's 429) is rendered from its own status and never falls through. The filter also upgrades a
  wrong verb on a known route from Express's 404 to a **405** with an `Allow` header — but only for a caller
  who passed the API-key check; an unauthenticated caller keeps the 404, so the route's existence is never
  confirmed to someone who cannot call it (`upgradeMethodNotAllowed`). Body shape:
  `{ statusCode, error, message, details?, timestamp, path }`. **The filter is the only place an errored
  request is logged** — `LoggingInterceptor` uses `tap()`, which fires on the success path only. 5xx log as
  `error` with the stack (client still gets a generic message); 4xx log as `warn` with a compact reason
  (validation details, else the message) so client-side failures and 429s stay visible.
- **Failures _outside_ the request cycle** (an `unhandledRejection` / `uncaughtException`, which the filter
  never sees) are caught by `installProcessSafetyNet` (`src/process-safety-net.ts`), wired from `main.ts`
  **only** — it logs, closes the app so shutdown hooks release ES/Redis, then `process.exit(1)` for Render to
  restart a clean process. Deliberately **not** in `configureApp`: that runs per e2e boot and would stack a
  listener each. This does not threaten the Redis fail-open — the ioredis client has its own `'error'` listener
  and cache ops are wrapped in `cacheAside`, so a Redis outage never reaches these process-level handlers.
- **Three input guards, three places**: free-text length caps are declared once in
  `presentation/common/input-limits.ts` and applied by the DTOs (**400**); `pageSize` above
  `SEARCH_MAX_PAGE_SIZE` is rejected in `SearchController` (**400**); `from+size` beyond
  `SEARCH_MAX_RESULT_WINDOW` is rejected in the ES adapter (**422**). The caps are not cosmetic — an unbounded
  `q` reached Lucene's fuzzy automaton and came back as a **502** (measured: 2000 chars fine, 3000 not).
- **Rate limiting is a global guard, fail-over not fail-open (D14–D19).** `RateLimitGuard` (extends
  `@nestjs/throttler`, registered via `APP_GUARD` in `rate-limit.module.ts`) counts each client-IP per endpoint
  through `RateLimitStorePort`. There is **one** throttler with a *resolvable* limit, not several named ones —
  several would subject every route to all of them; `resolveLimit` picks the per-endpoint budget by path prefix,
  and the generated key includes controller + handler, so exhausting `/search` cannot exhaust `/autocomplete`.
  The store is `FailoverRateLimitStore`: Redis for a shared count, falling **over** to an in-process counter on
  a Redis error — it never stops enforcing (fail-open would drop protection exactly when a Redis outage also
  drops the cache) and never fails a request (fail-closed would make Redis critical, breaking D8/`/health`).
  The Redis increment is **one atomic Lua eval** (INCR + conditional PEXPIRE + PTTL);
  splitting it reintroduces an off-by-one under concurrency. `GET /health` is exempt (Render polls it) and
  `RATE_LIMIT_ENABLED=false` is a full pass-through — both live in the options `skipIf`. Over-budget ⇒ **429**
  thrown by the guard as a typed `HttpException` (not `ThrottlerException`) so `AllExceptionsFilter` renders the
  standard body, and the headers read `RateLimit-*` because the guard overrides `headerPrefix` — the library's
  own default is `X-RateLimit-*`. Client IP comes from `req.ip`, which needs Express `trust proxy` set from
  `TRUST_PROXY_HOPS` in `app.setup.ts` — without it every client shares one bucket. The capacity load test runs
  with enforcement **off**; `loadtest/rate-limit.js` is the correctness run that floods one client and asserts
  429.
- **Suggestions inside `/search` appear only on low recall** (`total <= SEARCH_SUGGEST_MAX_HITS`);
  `GET /suggest` always returns them. The threshold is applied in `product-search.adapter.ts`, **not** in
  `SearchProductsUseCase` — that is the first place one looks and it is not there.
- **Config is Zod-validated and fail-fast (D12)**: `env.schema.ts` validates, `app-config.ts` maps to the
  namespaced `AppConfiguration` behind `APP_CONFIG`. Adapters read that token — **never `process.env`**.
  Nothing may assume `localhost`; the ES client factory picks API-key vs. basic auth and TLS from env, so the
  same code path runs locally and against Elastic Cloud + Upstash.
- **Health is three endpoints, and which one the platform polls is load-bearing (D39–D41).** Elasticsearch is
  critical (down ⇒ 503), Redis is non-critical (reported, still 200); the ES probe also reports `down` when
  the configured **index is missing** (readiness proves the data, not just the socket), and probe failure
  details are not published. `GET /health` is the full report — humans and the uptime monitor.
  **`GET /health/ready` is what `render.yaml` points at**: critical probes only, selected by the `critical`
  flag rather than by name, because Render polls it every **~4.3 s** (measured, not configurable) and a
  non-critical probe there spends a command per poll on a verdict it cannot change — that was ~605 k Upstash
  commands a month against a 500 k tier. `GET /health/live` calls nothing. Deploy consequence: against an
  unseeded Elasticsearch readiness never turns healthy and Render fails the deploy — the seed
  (`npm run seed:prod`) must be guaranteed before boot, and today it is manual. Adding an endpoint under
  `/health/` is free of exemption work: `matchesPath` matches sub-paths, so the API-key guard, the rate
  limiter, the trace sampler and the request logger all cover it the day it exists.
- **Observability is three independent pieces (D21–D25), and two of them are load-bearing at import time.**
  Logs are pino installed via `app.useLogger` in `main.ts`, so the ~30 `new Logger(Context)` call sites emit
  JSON untouched; the correlation id lives in `AsyncLocalStorage` (`shared/correlation.store.ts`), opened by a
  middleware in `app.setup.ts`, which is why a line logged inside a use-case carries it without any plumbing.
  **`main.ts` imports `tracing.preload` second, right after `reflect-metadata`, and that order is the
  feature**: OpenTelemetry patches modules as they are required, so an import added above it silently leaves
  http/Express/ioredis untraced — a spec asserts the order against `main.ts`'s source. The preload module
  starts the SDK **as a side effect of being required**, which is the whole point: calling `startTracing()`
  from inside `bootstrap()` runs *after* every static import has been evaluated, and ioredis loaded by then
  stays unpatched forever (measured — Redis emitted zero spans in production for a full day while
  Elasticsearch's were fine, because `@elastic/transport` instruments itself and does not depend on the hook). With
  `OTEL_EXPORTER_OTLP_ENDPOINT` unset the SDK is never constructed, which is what keeps CI and the e2e suites
  collector-free, and `/health` and `/metrics` are dropped at the **sampler** so the platform's polling does
  not bury real traffic — a hook would suppress the server span and orphan the probe's own ES/Redis spans.
  Elasticsearch needs no instrumentation package: `@elastic/transport` emits its own spans. The SDK options are
  built by `buildTracingConfig` (separately, so a spec can assert them) and include **`metricReaders: []`**:
  left unset, `NodeSDK` reads the env, where the metrics exporter defaults to OTLP, so an endpoint set for
  *tracing* also ships the HTTP instrumentation's histograms — it did exactly that in production until
  2026-07-27. Present-and-empty is what makes the SDK skip the `MeterProvider`; it is not the same as unset.
  Traces redact client input on purpose: a `requestHook` sets `url.query` to `[REDACTED]` on incoming HTTP
  spans, and the ioredis `dbStatementSerializer` records the command name only — without it a cache `SET`
  ships the entire serialized response to the trace backend as `db.query.text` (fixed in `f23afe7`).
- **Metrics cross the boundary through a port, never `prom-client` directly.** `METRICS_PORT` (recording, used
  by `cacheAside` and the fail-over store) and `METRICS_EXPORTER` (rendering, used only by `MetricsController`)
  are two tokens bound to **one** adapter instance in `infrastructure/observability/observability.module.ts`,
  which is `@Global` — the third and last global module after config. `METRICS_ENABLED=false` swaps in a no-op
  adapter so no call site branches. `buildMetricsAdapter` picks between **three** shapes: no-op, Prometheus
  only, or `CompositeMetricsAdapter` (Prometheus **plus** an OTLP push) when `OTEL_METRICS_EXPORT_ENABLED` is
  on. That flag is separate from the OTLP endpoint on purpose — configuring *tracing* must never start a
  metrics pipeline, which it silently did until `1452e7b`. The composite's `MeterProvider` is **never**
  registered as the global one: instrumentation libraries resolve meters from the global provider, and leaving
  it unset is what keeps their undeclared histograms out of the backend. Known gap (`PENDING-2026-07-28.md`
  B1): `MetricsInterceptor` records the HTTP metrics but runs **after** the guards, so 401s, 429s and
  unmatched 404s are never counted — the abuse signals are exactly the unmeasured ones, and its docstring's
  "every request" claim is wrong until that lands.
- **Log shipping is a pino transport, not a platform feature.** `LOKI_URL` unset means no worker, no timer, no
  socket. Set, `PinoLoggerAdapter` builds a multi-target transport — `pino/file` on fd 1 *and* `pino-loki` —
  so stdout keeps working. Labels are `service` and `env` only: `correlationId` stays a **field**, because a
  Loki stream is its label set and a per-request label mints a stream per request. Errors are silenced *and*
  an `error` listener is attached, because an unhandled one reaches `installProcessSafetyNet`, which exits the
  process — a log backend going down must not restart the API. **A shipped line must keep pino's numeric
  `level` and `time`** — the readable variants each silently killed a pipeline half on first activation (a
  string level routes to no worker target, dropping every line *including stdout*; an ISO time multiplies to
  NaN inside pino-loki and the batch is rejected under `silenceErrors`), so the ISO timestamp and level-label
  formatters apply only on the inline path (`7ee3757`, measured in production 2026-07-28). `GET /metrics` is **not** exempt from the rate limiter (unlike `/health`)
  and is excluded from the OpenAPI document with `@ApiExcludeEndpoint`, so ZAP never fuzzes it.
- **The API is private, and authentication is on by default (D30–D34).** `ApiKeyGuard` (`APP_GUARD` in
  `api-auth.module.ts`) requires `X-API-Key` on every route; `API_AUTH_ENABLED` defaults to **true** and
  enabling it without `API_KEYS` — or with any key shorter than **16 characters** — is a **startup failure**,
  so a deployment cannot come up open (or guessably keyed) by omission —
  which is why every spec fixture and both CI jobs set `API_AUTH_ENABLED=false` explicitly. `ApiAuthModule` is
  imported **after** `RateLimitModule` on purpose: global guards run in registration order, and the limiter
  must count an unauthenticated flood rather than let it be rejected for free. The exemptions are the operator
  paths and neither is open — `/health` is a public probe, `/metrics` has its own bearer.
  **`/docs` and `/docs-json` are guarded by a middleware in `swagger.setup.ts`, not by the guard**: Swagger
  mounts them straight onto Express, so no Nest guard ever runs for them — an easy way to leave the whole
  contract public while the data is locked. Keys are compared as SHA-256 digests with `timingSafeEqual`, and
  the rate limiter buckets by a truncated digest of a **valid** key (invalid ones fall back to the IP, so
  guessing cannot mint fresh budgets).
- **`config/load-config.ts` is the only module that reads `process.env`** — both the `APP_CONFIG` provider and
  the tracing bootstrap call it, because the bootstrap runs before the DI container exists (D12 stays true).

## Conventions

- **Conventional commits**, one per task group — never a mega-commit.
- **All code, comments, artifacts, and docs in English.** (Conversation with the user is in Spanish.)
- **ESLint enforces the style rules as errors**: `no-explicit-any`, `explicit-function-return-type`, and
  **`max-lines: 250`** per file. Split by responsibility rather than raising the cap; an `any` escape hatch
  needs an inline justification. `*.spec.ts` and `test/**` relax `max-lines`, `no-explicit-any` and the whole
  `no-unsafe-*` family (fixtures/mocks over dynamic ES/Redis shapes) — production code gets none of that.
- **Never return a domain/application model from a controller** — map to a response DTO
  (`*-response.mapper.ts`). Input DTOs are `class-validator` classes; unknown query params are 400 by
  `forbidNonWhitelisted`.
- **Tests**: AAA; unit specs co-located next to the code, e2e/integration under `test/`. Use-cases are tested
  with mocked ports; query builders with table-driven cases; the ES adapter has a real-ES integration spec.
- **Docs describe shipped behavior** (`README.md`, `postman/`); OpenSpec artifacts describe the plan. If
  implementation reveals a design gap, update `design.md`/the spec rather than silently diverging, and flip the
  matching `- [ ]` in `tasks.md` to `- [x]` as work lands.

## OpenSpec workflow

Implementation is driven by the skills/commands under `.claude/` rather than ad-hoc coding: `/opsx:propose`
creates a change, `/opsx:apply <name>` (or the `openspec-apply-change` skill) works its `tasks.md` in order,
and `/opsx:archive <name>` retires it — syncing delta specs into `openspec/specs/` on the way out. Precedence
when artifacts disagree: **spec scenarios → design.md → tasks.md → proposal.md**.

**Not all work goes through OpenSpec.** The six archives cover the feature work; post-ship maintenance — the
security workflows, the dependency policy, the 4xx logging / process safety net / OpenAPI hardening, the
keep-alive cron — landed as direct conventional commits with a write-up under `docs/`, no change folder. A new
capability gets a change; CI, dependency, ops and docs work does not.

Always check `openspec list` first — it reports **no active changes** as of the 2026-07-28 health-split
archive (six changes are now archived), and while it stays empty new work needs a new change rather than
tasks appended to an existing one. Note the flags are not uniform:
`openspec status --change <name> --json` takes `--change`, while validation does not — it is
`openspec validate <name> --strict` for a change and `openspec validate --specs --strict` for the
capability specs.
