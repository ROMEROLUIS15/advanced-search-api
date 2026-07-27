# Observability — 2026-07-27

Structured logging, a request correlation id, Prometheus metrics and optional OTLP tracing, plus the coverage
gate and the cheap follow-ups the QA review left open ([`QA-REVIEW-2026-07-26.md`](QA-REVIEW-2026-07-26.md)).

Driven through OpenSpec as change `add-service-observability` — proposal, delta specs, design decisions
**D21–D29** and 40 tasks — because this adds a capability and touches architecture, which is the criterion the
repo already documents. Like the earlier reports, **every number below came from running the command next to
it**.

| Commit | Type | What |
|---|---|---|
| `0194560` | feat(config) | The observability configuration surface, all of it inert by default |
| `42482ad` | feat(observability) | JSON logs with a request correlation id |
| `e335597` | feat(observability) | Prometheus metrics at `/metrics` |
| `c53d841` | feat(observability) | OTLP tracing, inert without an endpoint |
| `eebd0e4` | feat(cache) | Single-flight, TTL jitter, cached-payload validation |
| `ef99201` | perf(rate-limit) | Amortised sweep, EVALSHA for the Lua script |
| `cc71978` | fix(search) | Typed upstream error, inverted price range rejected |
| `eb2eec8` | test(coverage) | Mapper branches covered, coverage turned into a gate |

Net change: **67 files, +4002 / −112**.

---

## 1 · Structured logs and correlation id (`42482ad`)

**Problem.** Logs were unstructured text no aggregator could query, and the two lines describing one request
came from different places — the completion line from `LoggingInterceptor`, the error line from
`AllExceptionsFilter` — with nothing tying them together. Debugging a production failure meant matching
timestamps by eye.

**What shipped.** pino installed as the Nest `LoggerService`, so all ~30 existing `new Logger(Context)` call
sites emit JSON with no edit to any of them, and `bufferLogs: true` keeps the bootstrap lines structured too.
The correlation id lives in `AsyncLocalStorage`: a middleware in `app.setup.ts` honours an inbound
`X-Request-Id` (only if it matches a strict pattern — the value is echoed into a response header and into every
log line, so CRLF or unbounded length would be injection), generates one otherwise, and echoes it back.

**Why not the obvious alternatives.** A request-scoped provider makes the entire injection subtree
request-scoped; threading the id through the ports would put an HTTP artifact into the domain-facing contracts.
`nestjs-pino` brings its own HTTP middleware and would have logged every request a second time.

**Measured.** First line out of a booted build:

```json
{"level":"info","time":"2026-07-27T14:04:37.483Z","service":"advanced-search-api",
 "context":"Bootstrap","msg":"Tracing enabled, exporting over OTLP"}
```

Across the 4-minute load test below, the application wrote **314,794 log lines, every one valid JSON, all at
`info` — zero warnings, zero errors**.

## 2 · Metrics (`e335597`)

`GET /metrics` in Prometheus format: request count and duration by method, matched route and status; Node
process metrics; and two counters the service could not answer before — cache hit/miss and rate-limit
fail-over.

**Layering.** `application/` may not import an infrastructure library, so recording goes through
`METRICS_PORT`; the endpoint renders through `METRICS_EXPORTER`; both tokens resolve to one adapter instance.
`METRICS_ENABLED=false` binds a no-op so no call site branches.

**Two decisions worth stating.** The RED metrics hang off the response's `finish` event, not an rxjs operator:
`tap` fires only on success — the same blind spot that once left 4xx unlogged — and `finalize` runs before the
exception filter has written the status. And the route label is the *matched pattern*, never `request.url`,
which would give the registry one time series per distinct query string.

**Measured**, straight from `/metrics` after the load test:

```
http_requests_total{method="GET",route="/search",status="200"} 210278
http_requests_total{method="GET",route="/autocomplete",status="200"} 73606
http_requests_total{method="GET",route="/suggest",status="200"} 30877
search_cache_events_total{result="hit"} 249983
search_cache_events_total{result="miss"} 33901
rate_limit_failover_total 0
```

That hit ratio — **88.1 %** — is a number the service simply could not report a day earlier.

## 3 · Tracing (`c53d841`)

OpenTelemetry over OTLP, covering the HTTP request and the Redis calls; Elasticsearch needs no instrumentation
package because `@elastic/transport` depends on `@opentelemetry/api` and emits its own spans. The originally
planned `@opentelemetry/instrumentation-elasticsearch` **does not exist on npm** — the design was corrected
rather than the fact ignored.

**Ordering is the feature.** Instrumentation patches modules as they are required, so the bootstrap is the
second import in `main.ts`, right after `reflect-metadata`. An import added above it would leave http, Express
and ioredis untraced with nothing failing, so a spec asserts the order against `main.ts`'s own source.

**Inertness is the other feature.** With `OTEL_EXPORTER_OTLP_ENDPOINT` unset the SDK is never constructed — no
exporter, no spans, no overhead — which is what lets CI, the e2e suites and a local run work with no collector
in sight. The bootstrap runs before the DI container exists, so `config/load-config.ts` now holds the single
`process.env` read that both it and the `APP_CONFIG` provider share; D12 stays literally true.

**Measured against a real backend.** Exporting to Grafana Cloud throughout a 314k-request run: **no exporter
error, no retry warning, nothing but `info` in the log**.

## 4 · Cache, rate limiter and the remaining QA findings (`eebd0e4`, `ef99201`, `cc71978`)

| Finding | Before | Now |
|---|---|---|
| Cache stampede | N concurrent misses ⇒ N Elasticsearch queries | one shared in-flight load per key, per instance |
| Lockstep expiry | entries written together expired together | ±10 % TTL jitter, floored at 1 s |
| Cached payload trust | `JSON.parse` and serve | parsed against a zod schema; a mismatch is a miss |
| In-memory limiter | full map sweep **per hit** (O(n) per request) | amortised: every 30 s, or at once past 10k entries |
| Lua script | shipped on every request via `eval` | registered once, run through EVALSHA |
| Hit mapper | bare `Error` ⇒ 500 | `UpstreamResponseError` ⇒ 502 |
| Inverted price range | 200 with an empty list | 400 naming the field |
| Cache policy | no header | `public, max-age=<ttl>` on search, `no-store` on `/health` and `/metrics` |

A visible consequence of the payload validation: a cache hit is now a validated *copy*, not the stored object,
so two specs moved from `toBe` to `toStrictEqual`. Identity was never part of the contract.

## 5 · Coverage as a gate (`eb2eec8`)

Branch coverage was **88.06 %** against 97.83 % of statements, and the gap sat exactly where defects hide — the
null and fallback paths of the mappers. `search-hit.mapper` had 2/6 branches and no spec at all.

| | Before | After |
|---|---|---|
| Statements | 97.83 % | **98.34 %** |
| Branches | 88.06 % | **92.90 %** |
| Unit tests | 188 | **304** |

`coverageThreshold` now sits just under those values and CI's `quality` job runs `test:cov` instead of
`npm test` — the same suite plus one more verdict. **Verified the gate bites**: raising the branch threshold to
99 fails the run with `Jest: Coverage for branches (92.9%) does not meet "global" threshold (99%)`.

## 6 · What this cost — the k6 re-run

The design flagged one risk explicitly: the warm cache path gained an async-store lookup, a counter and a zod
parse, and the 4.65 ms p95 from 2026-07-23 was not to be inherited. Re-measured on the same battery, same
machine, with **tracing enabled and exporting to Grafana Cloud** — so this is the cost of everything added, not
of zod alone:

| Scenario | p95 2026-07-23 | p95 now | Δ | SLO |
|---|---|---|---|---|
| `search_cold` | 29.69 ms | 32.20 ms | +2.51 | p95 < 400 ✅ |
| `search_warm` | 4.65 ms | **5.53 ms** | +0.88 | p95 < 60 ✅ |
| `facets_cold` | 33.20 ms | 30.24 ms | −2.96 | p95 < 400 ✅ |
| `browse_paged` | 5.00 ms | 6.07 ms | +1.07 | p95 < 300 ✅ |
| `autocomplete` | 4.67 ms | 5.32 ms | +0.65 | p95 < 150 ✅ |
| `suggest` | 11.66 ms | 13.65 ms | +1.99 | p95 < 200 ✅ |
| `mixed_ramp` | 20.50 ms | 25.51 ms | +5.01 | p95 < 800 ✅ |

**314,761 requests at 1,368/s, 0.000 % failed, 1,260,356 checks passed.**

The warm path costs **0.88 ms more** and its budget is 60 ms. The D27 fallback — replacing the zod parse with a
cheaper shape hash — is therefore **not** needed, and that is a measurement, not an opinion.

---

## Verified green

| Check | Command | Result |
|---|---|---|
| Unit tests + coverage gate | `npm run test:cov` | 60 suites, **304 tests**, 98.34 % stmts / 92.90 % branches |
| Integration (real ES) | `npm run test:integration` | 5 tests pass |
| End-to-end (real ES + Redis) | `npm run test:e2e` | 8 suites, **34 tests** pass |
| Lint (type-aware) | `npm run lint:ci` | exit 0 |
| Build (strict + plugin) | `npm run build` | clean |
| Dependency vulns | `npm audit` | **0 total**, after adding pino, prom-client and the OTel SDK |
| Capacity | `npm run loadtest` | 314,761 requests, 0 failures, every SLO met |
| Log format | booted build | 314,794 lines, all JSON, all `info` |
| Trace export | booted build + Grafana Cloud | no exporter error across the whole run |

## Deferred, on purpose

- **Log shipping and alerting.** JSON logs are the prerequisite, not the solution. Where the lines go, how long
  they are kept and what pages someone at 3 a.m. are deployment and cost decisions.
- **A scraper for `/metrics`.** The endpoint is real; running Prometheus or a Grafana agent against it is
  infrastructure this repo does not own.
- **The remaining minor findings** from the QA review's §5 that were not in scope here: `POST /search`
  answering 404 rather than 405.
