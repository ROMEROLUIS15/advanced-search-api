# Advanced Product Search API

[![CI](https://github.com/ROMEROLUIS15/advanced-search-api/actions/workflows/ci.yml/badge.svg)](https://github.com/ROMEROLUIS15/advanced-search-api/actions/workflows/ci.yml)

A backend search service for product/manufacturer discovery, built with **NestJS + TypeScript**,
**Elasticsearch** (relevance, filtering, faceting, suggestions) and **Redis** (fail-open caching), in a
strict **hexagonal architecture**.

It exposes relevance-ranked full-text search with typo tolerance, faceted navigation, type-ahead
autocomplete, and "did you mean" suggestions — all read-only over a single seeded Elasticsearch index.

**Live:** <https://advanced-search-api-chet.onrender.com> — the base URL returns a service index; try
[`/health`](https://advanced-search-api-chet.onrender.com/health),
[`/search?q=drill`](https://advanced-search-api-chet.onrender.com/search?q=drill),
[`/autocomplete?q=cord`](https://advanced-search-api-chet.onrender.com/autocomplete?q=cord) or
[`/suggest?q=driil`](https://advanced-search-api-chet.onrender.com/suggest?q=driil).
It runs on Render's free instance type, which spins down when idle — the first request after a pause can
take up to a minute.

## Capabilities

- **Full-text search** across name / description / category / subcategories / location, ranked by BM25 with a
  `function_score` that boosts by popularity and recency.
- **Filtering** by category, subcategory (any-of), location, and price range — combinable or individual.
- **Faceting**: aggregation counts returned with results, using correct combined-filter semantics (a facet's
  own dimension is not narrowed by its own selection, so it can be widened).
- **Pagination** + **multi-key sorting** (relevance / popularity / created_at) with a stable tiebreaker.
- **Autocomplete** (`search_as_you_type`) and **"did you mean" / related** query suggestions.
- **Redis caching** for hot results and autocomplete prefixes — strictly **fail-open** (a Redis outage never
  fails a request).
- **Health / readiness** endpoint reporting Elasticsearch and Redis connectivity.

## Architecture

Hexagonal / clean architecture with dependencies pointing inward only:

```
domain  →  application (use-cases + ports)  →  infrastructure (Elasticsearch + Redis adapters)
                                            →  presentation (HTTP controllers + DTOs)
```

- **domain** — framework-free `Product` entity and `Money` value object with invariants.
- **application** — use-cases and the ports they depend on (`interface` + `Symbol` token pairs). Use-cases
  depend only on tokens; adapters are bound in the Nest modules (`{ provide: TOKEN, useClass: Adapter }`).
- **infrastructure** — Elasticsearch (client, index, search, autocomplete, suggestion, health) and Redis
  (cache, health) adapters. Elasticsearch/Redis types never cross a port.
- **presentation** — controllers, `class-validator` input DTOs, response DTOs (a domain entity is never
  serialized directly), and a global exception filter.

A single `GET /search` request returns hits **+ facets + suggestions** in **one Elasticsearch round-trip**.
The full design rationale (D1–D13) lives in [`openspec/changes/archive/2026-07-22-advanced-search-system/design.md`](openspec/changes/archive/2026-07-22-advanced-search-system/design.md).

### How ranking works

Text relevance uses a `multi_match` (BM25) with field boosts (`name^4`, `name.std^2`, `category.text^2`,
`subcategories.text^1.5`, `location.text^1`, `description^1`), `fuzziness: AUTO` for typo tolerance, and
`minimum_should_match: 60%`. That query is wrapped in a `function_score` that multiplies in two business
signals: popularity (`field_value_factor`, `ln1p`) and recency (`gauss` decay over `createdAt`). So at
comparable textual relevance, a more popular and more recent product ranks higher. The boost weights, recency
scale and popularity factor are environment-configurable. With no `q`, search runs in browse mode
(`match_all`) ordered by the selected sort (popularity by default).

### How faceting works

Facet filters are applied as a `post_filter`, so the returned **hits** respect every selection while the
**aggregation universe** stays at "everything matching the text query". Each facet is then computed inside a
`filter` aggregation that applies all *other* selected filters **except its own dimension** — the standard
recipe that lets a narrowed dimension still be widened. Try it:

```
GET /search?category=Tools     # hits are all Tools, but facets.categories still lists other categories
```

## Tech stack

NestJS 11 · TypeScript (strict) · Elasticsearch 8 (`@elastic/elasticsearch`) · Redis (`ioredis`) ·
`class-validator` / `class-transformer` · Zod (env validation) · Helmet · Jest / Supertest.

## API

Base URL: `https://advanced-search-api-chet.onrender.com` (deployed) or `http://localhost:3000` (local).

### `GET /`

Service index: name, version, the list of endpoints with a one-line description of each, and a docs link.
Takes no parameters. Any other unrouted path still returns a typed `404`.

> Added after the first deploy: the base URL answered a bare `404`, which reads as a broken service to
> anyone opening the link. It is operational metadata, not a domain capability — so unlike `/search`,
> `/autocomplete`, `/suggest` and `/health`, it deliberately has no requirement of its own under
> `openspec/specs/`.

### `GET /search`

| Param | Type | Notes |
|---|---|---|
| `q` | string | free-text query; omit for browse mode |
| `category` | string | exact category |
| `subcategory` | string / repeatable / CSV | ANY-of match |
| `location` | string | exact location |
| `minPrice`, `maxPrice` | number | inclusive price range |
| `sort` | `relevance` \| `popularity` \| `created_at` | default `relevance` (`popularity` when `q` is empty) |
| `order` | `asc` \| `desc` | default `desc` |
| `page` | integer ≥ 1 | default 1 |
| `pageSize` | integer 1..`SEARCH_MAX_PAGE_SIZE` | default `SEARCH_DEFAULT_PAGE_SIZE` |

Response:

```jsonc
{
  "data": [ { "id": "tool-001", "name": "Cordless Drill 18V", "description": "...", "category": "Tools",
              "subcategories": ["Power Tools","Drills"], "location": "Berlin", "price": 129.99,
              "currency": "USD", "popularity": 480, "createdAt": "2026-05-10T09:00:00.000Z", "score": 12.3 } ],
  "meta": { "total": 3, "page": 1, "pageSize": 20, "totalPages": 1, "sort": "relevance", "order": "desc" },
  "facets": { "categories": [{ "key": "Tools", "count": 3 }], "subcategories": [...], "locations": [...],
              "priceRanges": [{ "to": 50, "count": 0 }, { "from": 50, "to": 100, "count": 0 }, ...] },
  "suggestions": { "didYouMean": null, "related": [] }
}
```

Errors: `400` (invalid/unknown param or `pageSize` above the max), `422` (`page`×`pageSize` beyond
`max_result_window`), `429` (rate limit exceeded — see below), `503` (Elasticsearch unreachable).
Suggestions are populated only on low recall (`total ≤ SEARCH_SUGGEST_MAX_HITS`).

### `GET /autocomplete?q=<prefix>&limit=<1..20>`

`q` is required; `limit` defaults to 10. Returns `{ "data": [{ "text": "Cordless Drill 18V", "score": 8.1 }] }`.

### `GET /suggest?q=<text>`

Returns `{ "data": { "didYouMean": "drill", "related": ["drill"] } }`.

### `GET /health`

`200` when Elasticsearch is up; `503` when it is down. Redis is non-critical (reported but still `200`).
Never rate limited — the platform polls it as its readiness probe.

```json
{ "status": "ok", "info": { "elasticsearch": { "status": "up" }, "redis": { "status": "up" } } }
```

### Rate limiting

Each client (by IP) has a per-endpoint budget within a rolling window: **60/min** for `/search` and
`/suggest`, **300/min** for `/autocomplete` (it fires on nearly every keystroke), **120/min** elsewhere.
`/health` is exempt. Every response advertises the remaining budget so a client can slow down before being
refused:

```
RateLimit-Limit: 60
RateLimit-Remaining: 57
RateLimit-Reset: 41          # seconds until the window resets
```

Over budget returns **429** in the standard error body, plus `Retry-After`:

```json
{ "statusCode": 429, "error": "Too Many Requests", "message": "Rate limit exceeded, retry after the window resets",
  "timestamp": "…", "path": "/search?q=drill" }
```

The counter lives in Redis so the limit is shared across instances, and falls over to an in-process counter if
Redis is unavailable — it never stops enforcing and never fails a request, so Redis stays non-critical. All
budgets are environment-tunable, and `RATE_LIMIT_ENABLED=false` turns enforcement off (used by the load-test
capacity run). Behind a proxy, set `TRUST_PROXY_HOPS` so the real client IP is read from `X-Forwarded-For`.

## Getting started

Prerequisites: **Node.js ≥ 20** and **Docker** (for Elasticsearch + Redis).

### Option A — Docker (recommended)

Brings up Elasticsearch, Redis and the API together:

```bash
docker compose up -d --build          # ES + Redis + API
docker compose --profile seed run --rm seed   # one-shot: provision the index + load the dataset
curl "http://localhost:3000/search?q=drill"
```

Stop with `docker compose down` (add `-v` to also remove the data volumes).

### Option B — local Node (Elasticsearch + Redis via Docker)

```bash
docker compose up -d elasticsearch redis   # just the dependencies
cp .env.example .env                        # defaults already point at localhost
npm install
npm run seed                                # provision index + load dataset
npm run start:dev                           # http://localhost:3000
```

## Configuration

Environment is validated at boot (Zod) — the app fails fast on missing/invalid variables. See `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | |
| `PORT` | `3000` | |
| `CORS_ORIGINS` | — | comma-separated; empty ⇒ same-origin in prod, reflected in dev |
| `ELASTICSEARCH_NODE` | — | `http://…` local, `https://…` cloud (required) |
| `ELASTICSEARCH_API_KEY` | — | base64 API key (cloud) |
| `ELASTICSEARCH_USERNAME` / `ELASTICSEARCH_PASSWORD` | — | basic auth (local, optional) |
| `ELASTICSEARCH_INDEX` | `products` | alias name |
| `ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED` | `true` | |
| `REDIS_URL` | — | `redis://` local, `rediss://` (TLS) for Upstash (required) |
| `CACHE_TTL_SEARCH` / `CACHE_TTL_AUTOCOMPLETE` | `300` / `60` | seconds |
| `SEARCH_DEFAULT_PAGE_SIZE` / `SEARCH_MAX_PAGE_SIZE` | `20` / `100` | |
| `SEARCH_SUGGEST_MAX_HITS` | `5` | `/search` surfaces suggestions only at/below this hit count |
| `SEARCH_MAX_RESULT_WINDOW` | `10000` | `from+size` beyond this ⇒ `422` |
| `RELEVANCE_POPULARITY_FACTOR` | `1` | |
| `RELEVANCE_RECENCY_SCALE` / `RELEVANCE_RECENCY_DECAY` | `90d` / `0.5` | |
| `RATE_LIMIT_ENABLED` | `true` | `false` disables enforcement (load-test capacity run, rollback) |
| `RATE_LIMIT_WINDOW_SECONDS` | `60` | rolling window per client per endpoint |
| `RATE_LIMIT_SEARCH` / `RATE_LIMIT_SUGGEST` | `60` / `60` | requests per window |
| `RATE_LIMIT_AUTOCOMPLETE` | `300` | higher — fires on nearly every keystroke |
| `RATE_LIMIT_DEFAULT` | `120` | any other limited route (`GET /`) |
| `TRUST_PROXY_HOPS` | `0` | proxy hops to trust for the client IP; `1` behind Render |

## Testing

```bash
npm test                 # unit tests (mocked ports) — no infrastructure required
npm run test:e2e         # HTTP e2e — requires the Docker stack up + seeded
npm run test:integration # Elasticsearch adapters against real ES — requires the Docker stack up
npm run lint             # ESLint (no-explicit-any as error, max 250 lines/file) — autofixes
npm run lint:ci          # same rules, no autofix — what CI runs
```

Tests follow the AAA pattern; unit specs are co-located with the code, e2e/integration specs live in `test/`.

All of it runs on every push and pull request to `main` via
[`.github/workflows/ci.yml`](.github/workflows/ci.yml): one job for lint, unit tests and the build, and a
second that starts Elasticsearch and Redis from `docker-compose.yml`, seeds the index and runs the e2e and
integration suites.

## Load testing

A [k6](https://k6.io) battery lives in [`loadtest/`](loadtest/README.md) — seven scenarios that measure the
cached and uncached search paths separately, plus faceting, browse, autocomplete, suggestions and a ramp to 50
concurrent users. It sits outside `src/`, adds no dependency, and only issues `GET`s against the public
contract.

```bash
npm run loadtest         # local battery (~4 min) — needs the stack up, seeded, and the API running
npm run loadtest:smoke   # low-rate correctness run against the deployment (~30 s)
npm run loadtest:report  # render the exported summaries into Markdown
```

Last run (2026-07-23): **366,306 requests, zero failures**, uncached search at 29.7 ms p95 and cached at
4.7 ms p95. Full results and the method behind them are in
[`docs/LOAD-TEST-2026-07-23.md`](docs/LOAD-TEST-2026-07-23.md); the accompanying project audit is in
[`docs/AUDIT-2026-07-23.md`](docs/AUDIT-2026-07-23.md).

## Deploy (Elastic Cloud Serverless + Upstash + Render)

The service is environment-driven and runs identically locally and in the cloud — only the env values change.
This repo is deployed at <https://advanced-search-api-chet.onrender.com> (Render, Ohio, free plan,
auto-deploying from `main`); the steps below are what it took, and reproduce it from scratch.

1. **Provision managed services**
   - **Elasticsearch**: an *Elastic Cloud Serverless* project → capture the endpoint and create a base64
     **API key**. (Serverless manages shards automatically — the index mapping intentionally sets no
     `number_of_shards`/`number_of_replicas`.)
   - **Redis**: an *Upstash* database → capture its `rediss://` URL.
2. **Create the service from the blueprint** — in Render, *New → Blueprint Instance* pointed at this repo.
   [`render.yaml`](render.yaml) declares a Docker web service with `healthCheckPath: /health` and
   `autoDeploy` on `main`. Use the blueprint rather than creating a web service by hand: a dashboard-created
   **Node** service sets `NODE_ENV=production`, so `npm install` skips the devDependencies and the build dies
   with `sh: 1: nest: not found`. The Dockerfile's builder stage runs a full `npm ci`, so it is unaffected.
   Render prompts for the four secrets (they are never stored in the repo):
   ```
   ELASTICSEARCH_NODE=https://<your-project>.es.<region>.gcp.elastic.cloud:443
   ELASTICSEARCH_API_KEY=<base64-api-key>
   REDIS_URL=rediss://default:<password>@<host>.upstash.io:6379
   CORS_ORIGINS=<comma-separated allowed origins, or empty>
   ```
3. **Deploy** — Render builds the `Dockerfile` and routes traffic once `GET /health` returns `200`; the app
   validates its environment at boot and fails fast if anything is missing. Note the free instance type spins
   down when idle, so the first request after a pause takes a while.
4. **Seed once** against the managed cluster via a one-off job/shell: `npm run seed:prod`
   (`node dist/seed/seed.command.js`). Idempotent by document id.
5. **Verify**: `GET /health` is green and `GET /search?q=drill` returns hits online.

Rollback: config is externalized, so reverting to a previous image needs no code change; for mapping changes,
build a new versioned index and flip the `products` alias.

## Postman

Import [`postman/advanced-search-api.postman_collection.json`](postman/advanced-search-api.postman_collection.json).
The collection uses a `baseUrl` variable, pointing at the live deployment
(`https://advanced-search-api-chet.onrender.com`) so the requests run as imported — set it to
`http://localhost:3000` to hit a local instance.

Its 15 requests walk the whole surface: every search dimension (text, category, subcategory ANY-of, location,
price range), each sort key (`relevance`, `popularity`, `created_at`), pagination, the exclude-own-dimension
facet behaviour, autocomplete, suggestions, health, and two rejected requests showing the typed error body —
a `400` validation error and a `429` rate-limit rejection.

Every request also carries a **saved response example** captured from the live deployment, so the payload
shapes — facet buckets, pagination `meta`, `didYouMean`, the error body — stay readable even if the managed
Elasticsearch or Redis behind the demo is no longer reachable.

Prefer plain text over importing a collection? [`api.http`](api.http) covers the same surface for the VS Code
**REST Client** extension (or a JetBrains IDE): open it and click *Send Request* above any block. Flip its
`@baseUrl` between the deployment and `http://localhost:3000`.

## Project layout

```
src/
  domain/          # entities + value objects (framework-free)
  application/     # use-cases, ports (Symbol tokens), models, caching helpers
  infrastructure/  # elasticsearch/ and redis/ adapters + client factories
  presentation/    # controllers, DTOs, exception filter, logging interceptor
  seed/            # dataset fixture + seed CLI (Nest standalone context)
test/              # e2e + integration specs
loadtest/          # k6 battery + smoke run (no dependency on the app)
docs/              # audit and load-test reports
openspec/          # spec-driven design artifacts (proposal, design, specs, tasks)
```
