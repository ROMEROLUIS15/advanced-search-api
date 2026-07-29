# Advanced Product Search API

[![CI](https://github.com/ROMEROLUIS15/advanced-search-api/actions/workflows/ci.yml/badge.svg)](https://github.com/ROMEROLUIS15/advanced-search-api/actions/workflows/ci.yml)
[![CodeQL](https://github.com/ROMEROLUIS15/advanced-search-api/actions/workflows/codeql.yml/badge.svg)](https://github.com/ROMEROLUIS15/advanced-search-api/actions/workflows/codeql.yml)
[![Security](https://github.com/ROMEROLUIS15/advanced-search-api/actions/workflows/security.yml/badge.svg)](https://github.com/ROMEROLUIS15/advanced-search-api/actions/workflows/security.yml)

A backend search service for product/manufacturer discovery, built with **NestJS + TypeScript**,
**Elasticsearch** (relevance, filtering, faceting, suggestions) and **Redis** (fail-open caching), in a
strict **hexagonal architecture**.

It exposes relevance-ranked full-text search with typo tolerance, faceted navigation, type-ahead
autocomplete, and "did you mean" suggestions — all read-only over a single seeded Elasticsearch index.

**Live:** <https://advanced-search-api-chet.onrender.com> — the base URL returns a service index; try
[`/health`](https://advanced-search-api-chet.onrender.com/health),
[`/search?q=drill`](https://advanced-search-api-chet.onrender.com/search?q=drill),
[`/autocomplete?q=cord`](https://advanced-search-api-chet.onrender.com/autocomplete?q=cord) or
[`/suggest?q=driil`](https://advanced-search-api-chet.onrender.com/suggest?q=driil), or browse the whole
contract interactively in the **[Swagger UI at `/docs`](https://advanced-search-api-chet.onrender.com/docs)**.
It runs on Render's free instance type, which spins down when idle; a scheduled keep-alive
([`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml)) pings `/health` every 10 minutes
**round the clock** so it stays warm and answers in ~0.5 s at any hour. That costs ~730 of the 750
instance-hours the free tier grants the whole workspace per month, which fits only while this is the single
free service in it. If the workflow is disabled, the first request after a pause pays a ~20 s cold start.

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
The design rationale is cited by decision ID (D1–D29) across three changes:
[D1–D13 — core system](openspec/changes/archive/2026-07-22-advanced-search-system/design.md),
[D14–D19 — rate limiting](openspec/changes/archive/2026-07-23-add-request-rate-limiting/design.md) and
[D21–D29 — observability](openspec/changes/archive/2026-07-27-add-service-observability/design.md); D20
(Elasticsearch timeout/retries) is documented under [Trade-offs](#trade-offs-and-future-work).

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
`class-validator` / `class-transformer` · Zod (env validation) · Helmet · OpenAPI (`@nestjs/swagger`) ·
Jest / Supertest.

## API

Base URL: `https://advanced-search-api-chet.onrender.com` (deployed) or `http://localhost:3000` (local).

### Authentication

**This API is not public.** Every endpoint requires an API key, presented as an `X-API-Key` header; without a
valid one the response is `401` in the standard error envelope.

```bash
curl -H "X-API-Key: $API_KEY" "https://advanced-search-api-chet.onrender.com/search?q=drill"
```

Two groups sit outside the scheme, and neither is open: the health family (`GET /health`, `/health/ready`,
`/health/live`) needs no credential because the platform's readiness probe cannot send one and a 401 there
would be read as an unhealthy instance, and
`GET /metrics` carries its own bearer token instead, so a monitoring agent never needs an application key. The
published contract at `/docs` and `/docs-json` **is** protected — gating the data while serving its blueprint
would be pointless.

Several keys are valid at once (`API_KEYS` is a list), which is how a key is rotated: add the new one, move
consumers across, then remove the old. Authentication is **on unless explicitly disabled** — a deployment that
enables it without configuring a key refuses to start rather than coming up open, so the failure is loud
instead of silent. Local development and CI set `API_AUTH_ENABLED=false` deliberately and visibly.

The full contract is published as **OpenAPI**: an interactive Swagger UI at **`/docs`** and the raw spec at
**`/docs-json`**. The schema is derived from the `class-validator` DTOs by the `@nestjs/swagger` CLI plugin, so
it stays in sync with validation automatically. `/docs-json` is also what the DAST scan consumes (see
[Security](#security)).

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
| `q` | string, ≤ 256 chars | free-text query; omit for browse mode |
| `category` | string, ≤ 128 chars | exact category |
| `subcategory` | string / repeatable / CSV, ≤ 20 values of ≤ 128 chars | ANY-of match |
| `location` | string, ≤ 128 chars | exact location |
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

Errors: `400` (invalid/unknown param, a value past its length limit, or `pageSize` above the max), `422`
(`page`×`pageSize` beyond `max_result_window`), `429` (rate limit exceeded — see below), `503` (Elasticsearch
unreachable). Suggestions are populated only on low recall (`total ≤ SEARCH_SUGGEST_MAX_HITS`).

The length caps are not decoration. `q` feeds a `multi_match` with `fuzziness: AUTO`, and Lucene refuses to
build the fuzzy automaton for a single token past roughly 2 KB — measured against this deployment, 2000
characters answered `200` and 3000 answered **`502`**, reporting a healthy cluster as broken for what was
really bad input. The cap turns that into a plain `400`; independently, a `400` coming back *from*
Elasticsearch is now mapped to `400` rather than `502`, since a rejected query is the caller's, not the
engine's.

### `GET /autocomplete?q=<prefix>&limit=<1..20>`

`q` is required and capped at 256 characters; `limit` defaults to 10. Returns
`{ "data": [{ "text": "Cordless Drill 18V", "score": 8.1 }] }`.

### `GET /suggest?q=<text>`

`q` is required and capped at 256 characters. Returns
`{ "data": { "didYouMean": "drill", "related": ["drill"] } }`.

### `GET /health`

`200` when Elasticsearch is up; `503` when it is down. Redis is non-critical (reported but still `200`).
Never rate limited. Elasticsearch counts as *up* only when the configured index actually exists behind the
alias: readiness proves the data, not just the socket, so an unseeded cluster reports `503` and the response
never includes probe failure details.

```json
{ "status": "ok", "info": { "elasticsearch": { "status": "up" }, "redis": { "status": "up" } } }
```

### `GET /health/ready` and `GET /health/live`

Two narrower views for machines, same body shape, same `no-store`, also open and never rate limited.

`GET /health/ready` is **what Render polls** (`healthCheckPath`), several times a minute. It evaluates the
*critical* dependencies only — today Elasticsearch and its index — and deliberately does not probe Redis:
a non-critical outage can never change this verdict, so asking would spend a command per poll on a result
that is discarded. It answers `503` under the same rules as `/health`, which is what makes a deploy against
an unseeded cluster fail rather than serve errors.

`GET /health/live` answers `200` whenever the process is running, calling nothing at all. It is what
separates "the service is dead" from "a dependency is down".

Read `/health` when you want the whole picture, Redis included — that is what the uptime monitor polls.

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
| `ELASTICSEARCH_REQUEST_TIMEOUT_MS` | `4000` | per-request timeout (D20) — tighter than the SDK's 30 s |
| `ELASTICSEARCH_MAX_RETRIES` | `2` | retry budget (D20) — fewer than the SDK's 3 |
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
| `TRUST_PROXY_HOPS` | `0` | proxy hops to trust for the client IP; `3` behind Render |
| `API_AUTH_ENABLED` | **`true`** | on unless disabled; enabling it with no key is a startup failure |
| `API_KEYS` | — | comma-separated valid keys, sent by clients as `X-API-Key`; each must be ≥ 16 characters |
| `LOG_LEVEL` / `LOG_PRETTY` | `info` / `false` | JSON logs; pretty is for a terminal and is refused in production |
| `METRICS_ENABLED` | `true` | `false` binds a no-op recorder and `/metrics` returns empty |
| `METRICS_TOKEN` | — | when set, `/metrics` requires `Authorization: Bearer <token>` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | **unset ⇒ no tracing SDK is started at all** |
| `OTEL_EXPORTER_OTLP_HEADERS` | — | `key=value,key=value`; only the first `=` separates |
| `OTEL_SERVICE_NAME` | `advanced-search-api` | service name on exported spans |
| `OTEL_TRACES_SAMPLER_RATIO` | `0.1` | parent-based: an inbound sampled trace stays sampled |
| `OTEL_METRICS_EXPORT_ENABLED` | `false` | **opt-in on its own**: an OTLP endpoint set for tracing ships no metrics |
| `OTEL_METRIC_EXPORT_INTERVAL_MS` | `60000` | flush interval; halving it doubles the samples stored |
| `LOKI_URL` | — | **unset ⇒ no log transport, worker or timer is constructed** |
| `LOKI_USERNAME` / `LOKI_PASSWORD` | — | Loki basic auth; set both or neither |

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
integration suites. Alongside it, three more workflows run the security scanning — see [Security](#security).

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

A later QA review — architecture, contract, security and testing, verified by ~60 black-box requests against
the deployment — is in [`docs/QA-REVIEW-2026-07-26.md`](docs/QA-REVIEW-2026-07-26.md). It found and fixed a
reproducible 502 on an over-long query, and lists what remains open. The observability work that followed is
in [`docs/OBSERVABILITY-2026-07-27.md`](docs/OBSERVABILITY-2026-07-27.md).

## Security

The HTTP edge is hardened in one place (`app.setup.ts`): Helmet security headers, env-aware CORS, a global
`ValidationPipe` with `whitelist` + `forbidNonWhitelisted` (unknown params ⇒ `400`), and a centralized
exception filter that maps typed errors to consistent bodies and never leaks internals — `5xx` log the stack
server-side while returning a generic message, `4xx` log as warnings so client-side failures stay visible.
Failures *outside* the request cycle (unhandled rejection / uncaught exception) are caught by a process-level
safety net that logs, drains connections and exits for a clean restart.

On top of that, four scanning layers run in CI on every push and PR (all free on a public repo):

| Layer | Tool | What it checks |
|---|---|---|
| **SAST** | CodeQL (`security-extended`) | the project's own TypeScript |
| **SCA** | Dependabot | vulnerable/outdated npm, GitHub Actions and Docker deps |
| **Secrets** | gitleaks | the full git history (blocking) |
| **DAST** | OWASP ZAP `api-scan` | the running API, driven by the `/docs-json` OpenAPI contract (blocking) |

DAST uses **api-scan over the OpenAPI**, not a passive baseline: the baseline spider follows HTML links and so
never discovers a JSON API's endpoints (it only reaches `/`), whereas api-scan imports the contract and fuzzes
every endpoint's parameters — SQL injection, XSS, command injection, SSTI, path traversal, Log4Shell and more,
all exercised against `q` & co. The scan is **blocking** (no `-I`) — any WARN or FAIL fails the build, with
design-decision false positives kept as IGNORE in `.zap/rules.tsv`. The latest run reached 128 URLs with
**0 findings** (118 checks passing), and `npm audit` reports **0 vulnerabilities** (dev and prod) — two targeted
`package.json` overrides close transitive DoS advisories in `js-yaml` and `brace-expansion`. The methodology and figures are in
[`docs/HARDENING-2026-07-25.md`](docs/HARDENING-2026-07-25.md).

## Observability

Three layers, each usable on its own and each off by default where it needs somewhere to send data.

**Structured logs.** Every line is JSON — timestamp, level, service, context, message — emitted by pino
installed as the Nest logger, so the existing `new Logger(Context)` call sites were not touched. Set
`LOG_PRETTY=true` outside production for a readable terminal.

**Correlation id.** Each request gets one: an inbound `X-Request-Id` is honoured when it is safe (strict
pattern — the value is echoed into a response header and into every log line), otherwise one is generated. It
rides in `AsyncLocalStorage`, so a line logged deep inside a use-case carries it without anyone passing it
down, and the completion line and the error line of the same request finally share an identifier.

```bash
curl -sS -D - -o /dev/null localhost:3000/search?q=drill | grep -i x-request-id
```

**Metrics.** `GET /metrics` in Prometheus format: request count and duration by route and status, Node process
metrics, plus two the service could not answer before — cache hits versus misses, and how often the rate-limit
counter fell over from Redis to memory. It is excluded from the OpenAPI document (an operations endpoint is not
part of the client contract) and it is **not** exempt from the rate limiter.

It is **protected in the deployed environment**: `METRICS_TOKEN` is set, so a scraper must send
`Authorization: Bearer <token>` and anyone else gets a 401. Route names, request volumes, error rates and cache
behaviour are useful to an operator and equally useful to someone probing the service, which is why the token
stops being optional the moment the API has real users.

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" https://advanced-search-api-chet.onrender.com/metrics
```

**Tracing.** OpenTelemetry over OTLP, covering the HTTP request, the Redis calls and — through the
Elasticsearch client's own instrumentation — the search itself. Entirely optional:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-<region>.grafana.net/otlp \
OTEL_EXPORTER_OTLP_HEADERS='Authorization=Basic <base64 instanceID:token>' \
npm start
```

With the endpoint unset **no SDK is started at all** — no exporter, no spans, no overhead — which is why the
test suites and CI need no collector. The bootstrap runs from the first import in `main.ts`: instrumentation
patches modules as they load, so an import placed above it would leave them untraced.

`/health` and `/metrics` are dropped at the sampler, so the platform's readiness polling does not bury real
traffic — measured within minutes of first enabling the exporter, the probes were producing thousands of
identical traces a day. It is a sampler and not an "ignore incoming request" hook on purpose: the hook would
suppress only the server span, leaving the health probe's Elasticsearch and Redis calls to be exported as
orphans. `NOT_RECORD` on the root takes the whole trace with it.

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
   [`render.yaml`](render.yaml) declares a Docker web service with `healthCheckPath: /health/ready` and
   `autoDeployTrigger: checksPass` on `main` — deploys wait for the commit's CI checks instead of racing
   them, at the cost of landing minutes after the push rather than seconds. Note Render skips the deploy if
   *no* checks exist at all, so the gate is only as real as the repo's workflows.
   Use the blueprint rather than creating a web service by hand: a dashboard-created
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
   validates its environment at boot and fails fast if anything is missing. The free instance type spins down
   after ~15 minutes idle, so an **external uptime monitor** (UptimeRobot, free tier) hits `/health` every
   5 minutes to keep it warm and emails on a non-200. Point it at `/health` specifically: every other route
   requires `X-API-Key`, so a monitor aimed at the root reports a permanent 401 outage. A GitHub cron was tried first and measured wanting:
   GitHub delivers a `*/10` schedule roughly once an hour, with multi-hour gaps —
   [`.github/workflows/keep-alive.yml`](.github/workflows/keep-alive.yml) stays only as an hourly-ish backstop
   probe (its comments carry the measurement). Two constraints shape the cadence: staying awake 24/7 spends
   ~730 of the 750 instance-hours the free tier allows *per workspace* each month, so the monitor and a second
   free service cannot both exist — going over the quota gets services suspended; on a paid instance type that
   never idles, delete both the monitor and the workflow. Scheduled workflows are also **auto-disabled after
   60 days without repo activity** — re-enable the backstop from the Actions tab if it goes quiet.
4. **Seed once** against the managed cluster via a one-off job/shell: `npm run seed:prod`
   (`node dist/seed/seed.command.js`). Idempotent by document id. **Order matters on the very first
   deploy**: readiness requires the seeded index to exist, so until this step has run `GET /health/ready`
   answers `503` and Render will fail the deploy rather than route traffic to it. That is the intended mode —
   an unseeded deployment must never serve errors — but the seed is a manual step today, so run it (against
   the managed cluster, from any shell with the prod env) and then let Render retry.
5. **Re-run the seed after any mapping or dataset change** — it is also the migration command. It compares a
   fingerprint of the index definition against the one recorded on the live index and, when they differ,
   builds `products_v<n+1>`, loads the dataset into it, and moves the alias in a single atomic operation.
   Reads never see a missing alias, so this is safe while the service is serving. Its log line says which
   version is now served and which is retained. Two consequences worth knowing before running it:
   **a product deleted from the dataset disappears** (the new index gets exactly what the JSON holds), and
   **cached results stay servable for up to `CACHE_TTL_SEARCH` (300 s)** after the flip, because cache keys
   are scoped by alias and the alias does not change.
6. **Verify**: `GET /health` is green and `GET /search?q=drill` returns hits online.

Rollback: config is externalized, so reverting to a previous image needs no code change. For the *data*, the
seed retains exactly one previous version, so a rollback is an alias move rather than a reindex — seconds,
and no dataset required:

```bash
curl -X POST "$ELASTICSEARCH_NODE/_aliases" \
  -H "Authorization: ApiKey $ELASTICSEARCH_API_KEY" -H 'Content-Type: application/json' \
  -d '{"actions":[{"remove":{"index":"products_v2","alias":"products"}},
                  {"add":{"index":"products_v1","alias":"products"}}]}'
```

Both actions must travel in **one** request: applied separately there is a window with no `products` alias,
and readiness — which Render polls every ~4.2 s as the deploy gate — reports the service down inside it.

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
Elasticsearch or Redis behind the deployment is temporarily unreachable.

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
docs/              # audit, load-test, hardening, QA-review and observability reports
openspec/          # spec-driven design artifacts (proposal, design, specs, tasks)
.github/           # CI + CodeQL + Security workflows and the Dependabot config
.zap/              # OWASP ZAP rule overrides for the DAST scan
```

## Trade-offs and future work

Resilience and observability were scoped deliberately rather than by reflex. What is in, and what was
consciously deferred and why:

- **Elasticsearch timeout and retries (done).** The client runs with an explicit **4 s `requestTimeout`** and
  **2 retries** instead of the SDK's 30 s / 3 defaults (env-tunable). For a read API with a single data source,
  a tight timeout is the highest-value resilience lever: it stops a *slow* — not just down — cluster from
  holding connections until the pool drains, and a smaller retry budget avoids amplifying load on an ailing
  single node.
- **Error observability and a process safety net (done).** Errors map centrally to typed bodies with no
  internal leakage; `5xx` log their stack server-side while `4xx` log as warnings, so a client looping on
  validation errors or hitting the rate limit is visible rather than silent. Beyond the request cycle, an
  unhandled rejection or uncaught exception is caught by a process-level safety net that logs it, drains the
  ES/Redis connections and exits non-zero for the orchestrator to restart a clean process.
- **No circuit breaker (deferred, on purpose).** A breaker earns its keep when you fan out to *several*
  downstream services and want to shed load or stop cascades during partial degradation. Here Elasticsearch is
  the sole source of data, so the correct behaviour when it is unavailable is already in place: fail fast to a
  typed `503`, which `/health` surfaces as a critical dependency, while the Redis cache stays fail-open. A
  breaker would add machinery for little gain at this scope. Because ES access sits behind a port, adding one
  later is a change to a single adapter — not a redesign.
- **Structured logging, metrics and tracing (done).** Logs are JSON from pino with a per-request correlation
  id carried in `AsyncLocalStorage`; `/metrics` exposes RED metrics plus cache and rate-limit-failover
  counters; OpenTelemetry exports traces over OTLP when an endpoint is configured and starts no SDK at all
  when it is not. See [Observability](#observability).
- **Log shipping and alerting (deferred).** JSON logs are the prerequisite for an aggregator, not a
  substitute for one. Where those lines are shipped, how long they are kept and what pages someone at 3 a.m.
  are deployment and cost decisions, not code — the same reasoning that keeps a Prometheus instance out of
  this repo while `/metrics` is served from it.
- **Scaling.** The index is read through an alias, so a mapping change is a new versioned index plus an alias
  flip with no downtime. The service is stateless behind its two managed dependencies, so it scales
  horizontally; the rate-limit counter already lives in Redis to stay correct across instances.
