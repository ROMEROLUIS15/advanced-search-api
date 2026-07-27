## Why

The service is operable but not observable. Logs are unstructured text lines that no aggregator can query, and
because the success line is emitted by `LoggingInterceptor` while the error line comes from
`AllExceptionsFilter`, **nothing ties the two lines of the same request together** — debugging a production
failure means eyeballing timestamps. There are no metrics at all, so questions an on-call engineer asks first
(what is the p95 right now, what share of requests are failing, is the cache actually being hit, did the rate
limiter fall over to its in-process counter) cannot be answered without adding code. And there are no traces,
so a slow request cannot be attributed to Elasticsearch, Redis or our own work.

The 2026-07-26 QA review scored observability **7.0 of 10** — the lowest axis by a wide margin, and the one
thing standing between this deliverable and a top mark. The same review left nine minor findings open; the
cheap ones are folded in here rather than left to rot in a list.

## What Changes

**Observability**

- Replace the default Nest text logger with **pino** installed as the application `LoggerService`, so the ~30
  existing `new Logger(Context)` call sites keep working unchanged and start emitting JSON. Local development
  keeps human-readable output.
- Add a **correlation id** per request: honour an inbound `X-Request-Id` or generate one, propagate it through
  `AsyncLocalStorage` so every log line of that request carries it, and echo it back on the response.
- Add **`GET /metrics`** in Prometheus text format: request rate, error rate and a duration histogram by route
  and status (RED), Node process metrics, and two counters that are invisible today — cache hit/miss and the
  rate-limit store falling over to memory.
- Add **OpenTelemetry tracing** exporting OTLP to Grafana Cloud, spanning the HTTP request, the Elasticsearch
  call and the Redis call. Strictly env-driven: with no endpoint configured the exporter is inert and the app
  boots exactly as today, so local runs, CI and the e2e suites need no collector.

**Coverage gates**

- Add a jest `coverageThreshold` set just under the measured baseline, and run `test:cov` in CI, so coverage
  stops being a number nobody enforces.
- Cover the branches concentrated in the mappers (`search-hit.mapper` at 2/6, `product-bulk` at 5/9,
  `es-errors`, `search-criteria.mapper`).

**QA-review follow-ups** (fixes to shipped behaviour)

- Single-flight and TTL jitter in `cacheAside`: today N concurrent misses issue N Elasticsearch round-trips and
  hot keys expire in lockstep.
- Stop sweeping the whole map on every hit in `InMemoryRateLimitStore` (O(n) per request on the degraded path).
- Use `defineCommand` so the rate-limit Lua script runs through EVALSHA instead of shipping on every request.
- Throw a typed error from `search-hit.mapper` — the one place production code escapes the error hierarchy.
- **BREAKING (contract)**: `minPrice > maxPrice` answers **400** instead of a 200 with an empty list.
- Send an explicit `Cache-Control` on search responses, which the service already caches in Redis.
- Validate the shape of a cached payload before serving it.

## Capabilities

### New Capabilities

- `service-observability`: structured logging with a request correlation id, a Prometheus metrics endpoint, and
  optional OTLP trace export — all configured through the validated environment, all inert by default.

### Modified Capabilities

- `product-search`: an inverted price range is rejected with 400 rather than silently returning no results, and
  search responses carry an explicit cache policy.

## Impact

- **New dependencies**: `pino` (+ a pretty transport for dev), `prom-client`, and the OpenTelemetry SDK with
  its HTTP/OTLP exporter. All are added to `npm audit`'s surface and to Dependabot's.
- **New endpoint**: `GET /metrics`, excluded from the public OpenAPI document (it is an operations endpoint,
  not part of the client contract) and therefore outside what the blocking ZAP api-scan exercises.
- **New configuration**: OTLP endpoint, headers and sampling ratio, a metrics toggle and an optional metrics
  token — all through `env.schema.ts` and `APP_CONFIG`, never `process.env`.
- **Touched code**: `main.ts` and `app.setup.ts` (logger and correlation middleware), `LoggingInterceptor` and
  `AllExceptionsFilter` (correlation id in the log line), `cache-aside.ts`, the two rate-limit stores, the ES
  hit mapper, the search DTO and response mapper.
- **CI**: `test:cov` becomes part of the `quality` job.
- **Deployment**: Render gains the OTLP credentials as secrets; nothing lands in the repo. With them unset the
  service behaves exactly as it does today.
