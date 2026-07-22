# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Advanced Product Search API** — NestJS + TypeScript over Elasticsearch (relevance, filtering, faceting,
suggestions) and Redis (fail-open cache), in a strict hexagonal architecture. Read-only over a single seeded
index. Endpoints: `GET /search`, `GET /autocomplete`, `GET /suggest`, `GET /health` (contract and env table
documented in `README.md`).

The system is **implemented**: `tasks.md` groups 1–15 are done; only §16 (provision managed ES/Redis, deploy,
seed online) is pending. `openspec/changes/advanced-search-system/` remains the design record —
`design.md` decisions **D1–D13** are cited by ID in code comments, so when a comment says "design D4", that is
where the rationale lives. Spec scenarios in `specs/<capability>/spec.md` are the acceptance criteria.

## Commands

```bash
npm run start:dev            # ts-node-dev watch mode on :3000 (needs ES + Redis reachable)
npm run build                # nest build + tsc-alias (rewrites @-aliases in dist/)
npm start                    # node dist/main.js
npm run seed                 # provision index + alias, bulk-load src/seed/dataset/products.seed.json (idempotent)
npm run lint                 # eslint --fix over {src,test}
npm test                     # unit specs (src/**/*.spec.ts) — mocked ports, NO infrastructure needed
npm run test:e2e             # test/*.e2e-spec.ts — REQUIRES the stack up AND seeded
npm run test:integration     # test/*.integration-spec.ts — REQUIRES a real Elasticsearch
```

Single test: `npx jest src/path/to/file.spec.ts`, or by name `npm test -- -t "excludes its own dimension"`.
Single e2e: `npx jest --config ./test/jest-e2e.json test/search.e2e-spec.ts`.

`test:e2e` / `test:integration` run `--runInBand` deliberately: every e2e suite talks to the *same* external
index and Redis, and in parallel workers the run ends with "a worker process has failed to exit gracefully".
Serially all suites pass and Jest exits on its own, so neither script needs `--forceExit`.

Stack up: `docker compose up -d elasticsearch redis` (deps only, then run the API locally), or
`docker compose up -d --build` (adds the API) plus `docker compose --profile seed run --rm seed` for a one-shot seed.

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
use-case, and register their controller. `app.module.ts` only assembles those plus the global `AppConfigModule`.

- **DI is exclusively via `Symbol` tokens.** Every port is `interface` + token
  (`PRODUCT_SEARCH_PORT`, `AUTOCOMPLETE_PORT`, `QUERY_SUGGESTION_PORT`, `PRODUCT_INDEX_PORT`, `CACHE_PORT`,
  `HEALTH_PROBE`, plus `APP_CONFIG`, `ELASTICSEARCH_CLIENT`, `REDIS_CLIENT`). Binding happens **only** in
  `infrastructure/*/{elasticsearch,redis}.module.ts` via `{ provide: TOKEN, useClass: Adapter }`. Use-cases
  `@Inject(TOKEN)` and never import an adapter class. `HEALTH_PROBE` is a `useFactory` array of probes.
- **Ports never leak ES/Redis types.** The currency across the boundary is `SearchCriteria`, `SearchOutcome`,
  `Facets`, `ProductSummary`, `QuerySuggestion`, `HealthReport` (in `application/models/`). `estypes` imports
  are confined to `infrastructure/elasticsearch/`.
- **`app.setup.ts` holds the whole HTTP pipeline** (Helmet with CSP off, env-aware CORS, global
  `ValidationPipe({whitelist, forbidNonWhitelisted, transform})`, `LoggingInterceptor`, `AllExceptionsFilter`,
  shutdown hooks) so `main.ts` and every e2e test exercise the identical edge. Add global edge behavior there,
  not in `main.ts`.
- **Path aliases** `@domain/* @application/* @infrastructure/* @presentation/* @config/* @shared/*` are declared
  in **three** places that must stay in sync: `tsconfig.json` `paths`, `package.json` `jest.moduleNameMapper`,
  and `test/jest-e2e.json` + `test/jest-integration.json`. `dist` resolution depends on `tsc-alias` running as
  part of `npm run build`.

## The non-obvious parts

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
  touching `CachePort` from a use-case. Keys are namespaced+versioned (`search:v1:<sha1>`) over *normalized*
  criteria — bump the namespace on a reindex/alias flip.
- **Index behind an alias (D1)**: physical `products_v1` read/written through the `products` alias;
  `ensureIndex()` is idempotent. The mapping intentionally sets **no** `number_of_shards`/`number_of_replicas`
  (Elastic Cloud Serverless rejects them).
- **Error mapping is centralized** in `AllExceptionsFilter`: `ResultWindowExceededError` → **422**,
  domain/application errors → **400**, ES `ResponseError` → **502**, ES `ElasticsearchClientError` → **503**,
  anything else → 500 with the stack logged server-side only. Throw typed errors; don't map status codes in
  controllers or adapters. Body shape: `{ statusCode, error, message, details?, timestamp, path }`.
- **Two different guards, two different codes**: `pageSize` above `SEARCH_MAX_PAGE_SIZE` is rejected in
  `SearchController` (**400**); `from+size` beyond `SEARCH_MAX_RESULT_WINDOW` is rejected in the ES adapter
  (**422**).
- **Suggestions inside `/search` appear only on low recall** (`total <= SEARCH_SUGGEST_MAX_HITS`);
  `GET /suggest` always returns them.
- **Config is Zod-validated and fail-fast (D12)**: `env.schema.ts` validates, `app-config.ts` maps to the
  namespaced `AppConfiguration` behind `APP_CONFIG`. Adapters read that token — **never `process.env`**.
  Nothing may assume `localhost`; the ES client factory picks API-key vs. basic auth and TLS from env, so the
  same code path runs locally and against Elastic Cloud + Upstash.
- **Health**: Elasticsearch is critical (down ⇒ 503), Redis is non-critical (reported, still 200).

## Conventions

- **Conventional commits**, one per task group — never a mega-commit.
- **All code, comments, artifacts, and docs in English.** (Conversation with the user is in Spanish.)
- **ESLint enforces the style rules as errors**: `no-explicit-any`, `explicit-function-return-type`, and
  **`max-lines: 250`** per file (relaxed for `*.spec.ts` and `test/**`). Split by responsibility rather than
  raising the cap; an `any` escape hatch needs an inline justification.
- **Never return a domain/application model from a controller** — map to a response DTO
  (`*-response.mapper.ts`). Input DTOs are `class-validator` classes; unknown query params are 400 by
  `forbidNonWhitelisted`.
- **Tests**: AAA; unit specs co-located next to the code, e2e/integration under `test/`. Use-cases are tested
  with mocked ports; query builders with table-driven cases; the ES adapter has a real-ES integration spec.
- **Docs describe shipped behavior** (`README.md`, `postman/`); OpenSpec artifacts describe the plan. If
  implementation reveals a design gap, update `design.md`/the spec rather than silently diverging, and flip the
  matching `- [ ]` in `tasks.md` to `- [x]` as work lands.

## OpenSpec workflow

Implementation is driven by the skills/commands under `.claude/` rather than ad-hoc coding:
`/opsx:apply advanced-search-system` (or the `openspec-apply-change` skill) reads the context files and works
`tasks.md` in order. Inspect with `openspec status --change advanced-search-system --json`; validate with
`openspec validate --change advanced-search-system`. Precedence when artifacts disagree:
**spec scenarios → design.md → tasks.md → proposal.md**.
