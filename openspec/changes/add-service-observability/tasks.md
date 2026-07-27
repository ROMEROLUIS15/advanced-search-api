## 1. Configuration and dependencies

- [x] 1.1 Add `pino`, `pino-pretty`, `prom-client`, `@opentelemetry/sdk-node`, `@opentelemetry/exporter-trace-otlp-http` and the `http` / `ioredis` instrumentations to `package.json`; confirm `npm audit` still reports 0 (no Elasticsearch instrumentation exists or is needed — see design D25)
- [x] 1.2 Extend `config/env.schema.ts` with `LOG_LEVEL`, `LOG_PRETTY`, `METRICS_ENABLED`, `METRICS_TOKEN`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_SERVICE_NAME` and `OTEL_TRACES_SAMPLER_RATIO` (0..1), all optional with safe defaults
- [x] 1.3 Map them into an `observability` namespace on `AppConfiguration` in `config/app-config.ts`, and extend the existing config specs
- [x] 1.4 Document every new variable in `.env.example` with the reasoning comments that file uses

## 2. Structured logging and correlation id

- [x] 2.1 Add `infrastructure/observability/pino-logger.adapter.ts` implementing Nest's `LoggerService` over pino, JSON in production and pretty in development (design D21)
- [x] 2.2 Add a correlation-id store over `AsyncLocalStorage` and the middleware that opens it, honouring an inbound `X-Request-Id` and generating one otherwise (design D22)
- [x] 2.3 Stamp the id onto every record from the pino adapter, and echo it in the `X-Request-Id` response header
- [x] 2.4 Wire the logger in `main.ts` with `bufferLogs: true`, and the middleware in `app.setup.ts` so e2e boots exercise it
- [x] 2.5 Unit-spec the adapter and the store: generated id, inbound id honoured, id present on both the interceptor's success line and the filter's error line
- [x] 2.6 e2e: a request returns an `X-Request-Id` header, and an inbound value is echoed back unchanged

## 3. Metrics

- [x] 3.1 Define `application/ports/metrics.port.ts` with the `METRICS_PORT` token — counters for cache hit/miss and rate-limit fail-over, plus request observation (design D24)
- [x] 3.2 Implement the `prom-client` adapter and a no-op adapter in `infrastructure/observability/`, bound by `METRICS_ENABLED`
- [x] 3.3 Add the presentation interceptor recording request count and duration by route and status (RED)
- [x] 3.4 Add `MetricsController` serving Prometheus text at `GET /metrics`, `@ApiExcludeEndpoint`, `no-store`, and a bearer check when `METRICS_TOKEN` is set (design D23)
- [x] 3.5 Count cache hits/misses from `cacheAside` and fail-over events from `FailoverRateLimitStore` through the port
- [x] 3.6 Unit-spec the adapters, the interceptor and the token guard (401 without the token when configured)
- [x] 3.7 e2e: `/metrics` returns Prometheus text including request and process metrics, and counts a served request under its route pattern. The OpenAPI exclusion is asserted as a unit test instead — `setupOpenApi` runs only from `main.ts`, so no document is mounted in an e2e boot

## 4. Distributed tracing

- [x] 4.1 Add `observability/tracing.bootstrap.ts` starting the OTel SDK from the validated env schema, with only the http, ioredis and Elasticsearch instrumentations (design D25)
- [x] 4.2 Import it as the first import in `main.ts`, with the comment explaining why ordering matters
- [x] 4.3 Make it fully inert when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset — no SDK start, no exporter
- [x] 4.4 Unit-spec both paths (inert without an endpoint, started with one) and assert the import ordering in `main.ts`

## 5. Cache hardening

- [x] 5.1 Add single-flight to `cacheAside`: concurrent misses for one key share a single `load()` (design D26)
- [x] 5.2 Apply ±10 % TTL jitter on write
- [x] 5.3 Validate the cached payload against a zod schema before serving it; a mismatch is a miss (design D27)
- [x] 5.4 Send `Cache-Control` per endpoint — `public, max-age=<TTL>` for search, `no-store` for `/health` and `/metrics` (design D28)
- [x] 5.5 Unit-spec single-flight (one load for N concurrent misses), jitter bounds, and a wrong-shape payload treated as a miss

## 6. Rate-limit store follow-ups

- [x] 6.1 Replace the per-hit full sweep in `InMemoryRateLimitStore` with lazy per-key expiry plus a bounded periodic sweep
- [x] 6.2 Move `RedisRateLimitStore` to `defineCommand` so the Lua script runs through EVALSHA
- [x] 6.3 Extend both specs, including that a long-lived store does not grow without bound

## 7. Remaining QA-review fixes

- [x] 7.1 Throw a typed application error from `search-hit.mapper` instead of a bare `Error`, and map it centrally
- [x] 7.2 Reject `minPrice > maxPrice` with 400 in the search DTO, with a table-driven spec
- [x] 7.3 e2e: an inverted price range answers 400

## 8. Coverage gates

- [x] 8.1 Add specs for the uncovered branches: `search-hit.mapper`, `product-bulk`, `es-errors`, `search-criteria.mapper`
- [x] 8.2 Add `coverageThreshold` to the jest config from the measured baseline (design D29)
- [x] 8.3 Switch the CI `quality` job from `npm test` to `npm run test:cov`

## 9. Documentation and verification

- [ ] 9.1 Document the observability surface in `README.md`: log format, correlation id, `/metrics`, tracing setup, and the new env table rows
- [ ] 9.2 Update `CLAUDE.md` with the non-obvious parts — bootstrap ordering, the ALS store, the metrics port, the cache single-flight
- [ ] 9.3 Run the full local gate: `lint:ci`, `test:cov`, `build`, and the e2e + integration suites with the stack up
- [ ] 9.4 Re-run the k6 battery and record whether the warm-path p95 moved (design D27 risk); fall back to the shape-hash alternative if the zod parse dominates
- [ ] 9.5 Write `docs/OBSERVABILITY-<date>.md` with the measured before/after, in the style of the existing reports
