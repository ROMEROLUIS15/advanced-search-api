## 1. Redis instrumentation (design D37) — lands and is verified alone

Shipped differently from the plan, and better: instead of loading the application through a dynamic import,
a **preload module** starts instrumentation as a side effect of being required. `main.ts` imports it first, and
CommonJS evaluates every `require` in order, so OpenTelemetry is registered before `AppModule` can pull in
ioredis. No `app.bootstrap.ts` was needed and `main.ts` keeps its ordinary static imports. D37's alternatives
table should be read with this as the chosen option.

- [x] 1.1 `src/infrastructure/observability/tracing.preload.ts` calls `startTracing()` at module evaluation
- [x] 1.2 `main.ts` imports the preload module directly below `reflect-metadata`, and reads `tracingStarted`
      from it instead of calling `startTracing()` inside `bootstrap()`
- [x] 1.3 Replace the `main.ts` import-order spec — it asserted the shape that left ioredis unpatched
- [x] 1.4 `tracing.preload.spec.ts` proves the ordering without a live Redis
- [x] 1.5 Gate green (`lint:ci`, `test:cov`, `build`). Verified at runtime that the order is what matters:
      preload first ⇒ `Redis.prototype.sendCommand` is patched; ioredis first ⇒ it is not
- [ ] 1.6 **Still outstanding, needs a deploy**: confirm in Tempo that a `/search` trace carries a
      `db.system=redis` span — the check that returned zero results on 2026-07-27

## 2. Configuration for both pipelines (design D38)

- [x] 2.1 `OTEL_METRICS_EXPORT_ENABLED`, `OTEL_METRIC_EXPORT_INTERVAL_MS`, `LOKI_URL`, `LOKI_USERNAME`,
      `LOKI_PASSWORD` — plus three refinements: export needs an endpoint, Loki credentials come in pairs, and
      credentials without a URL ship nothing
- [x] 2.2 Mapped into `ObservabilityConfig`; `load-config.ts` remains the only reader of `process.env`
- [x] 2.3 `telemetryStatusLine` reports all three pipelines in one line. Extracted from `main.ts` rather than
      written inline, because `collectCoverageFrom` drops the entry point and this deserves a spec
- [x] 2.4 Specs: both pipelines off by default; an endpoint alone still ships no metrics (the accident this
      default prevents); malformed values named at boot; no credential reaches the status line

## 3. Metrics export (design D35)

Design note: the plan said "both instruments in one method, in one file". It shipped as a **composite** —
`OtlpMetricsAdapter` owns the OTLP side, `CompositeMetricsAdapter` fans one port call out to both, and
`PrometheusMetricsAdapter` is untouched. The guarantee the design cared about (one `MetricsPort` call reaches
both, no call site changes) holds; keeping the scrape path byte-identical and the OTLP code in a file of its
own was worth the extra indirection.

- [x] 3.1 `@opentelemetry/exporter-metrics-otlp-http@0.221.0` + `@opentelemetry/sdk-metrics@2.10.0`, the same
      version line as the rest of the OTel packages; `npm audit` still 0
- [x] 3.2 `MeterProvider` + `PeriodicExportingMetricReader` + `OTLPMetricExporter`, built only when export is
      enabled *and* an endpoint exists, and **never** registered globally — asserted by a spec that checks the
      global provider is the same object before and after
- [x] 3.3 One `MetricsPort` call reaches both registries; a table-driven spec covers all four methods
- [x] 3.4 `GET /metrics`, its token and its OpenAPI exclusion untouched; the no-op adapter still branches nowhere
- [x] 3.5 Specs: both registries per call; nothing constructed when unconfigured; an OTLP endpoint alone does
      **not** start export; recording against an unreachable backend neither throws nor rejects
- [ ] 3.6 **Needs a deploy**: verify against Grafana Cloud that the four declared series arrive and that no
      `http_server_request_duration_seconds` reappears

## 4. Log shipping (design D36)

- [x] 4.1 `pino-loki@3.0.0` wired through `pino.transport`, constructed only when `LOKI_URL` is set — with it
      unset not a single worker, timer or socket exists
- [x] 4.2 Multi-target transport: `pino/file` on fd 1 next to `pino-loki`, so Render's log view stays populated.
      Pretty mode replaces the stdout target rather than disabling shipping
- [x] 4.3 Labels are `service` and `env`; `propsToLabels` deliberately left unset, with the per-request-stream
      reason written beside them
- [x] 4.4 `silenceErrors: true` **and** an `error` listener on the transport stream — the listener is the half
      that matters, since an unhandled one reaches `installProcessSafetyNet` and exits the process
- [x] 4.5 Specs stub `pino.transport` rather than spawning threads, and assert the decisions: no transport when
      unconfigured, stdout kept, labels bounded, errors silenced and handled, basic auth only when whole, and
      the correlation id still emitted as a field
- [ ] 4.6 **Needs a deploy**: verify in Loki a line from a real request, then pivot from a Tempo trace to its
      `correlationId`

## 5. Measure what was estimated (design "Risks")

- [ ] 5.1 Record the actual active series count against the ~400 estimate, and the log volume per day against
      the <10 MB/month estimate
- [ ] 5.2 If either exceeds the free tier, fall back to the option named in D35 (scrape from the keep-alive
      cron and `remote_write`) rather than inventing a new one

## 6. Documentation

- [x] 6.1 "Deferred, on purpose" rewritten: alerting stays deferred, the scraper item is resolved by inverting
      it (the process pushes; nothing scrapes), with the two constraints that decided it recorded. The measured
      numbers from group 5 are still to be appended after the deploy
- [x] 6.2 Five new rows in the README env table, plus the `API_KEYS` minimum length
- [x] 6.3 `CLAUDE.md`: the preload/load-order rule with the measurement behind it, the three shapes
      `buildMetricsAdapter` picks between, and the log-shipping bullet
- [x] 6.4 Gate green and both external suites pass with **no telemetry backend configured** — `lint:ci`,
      70 suites / 458 unit tests, `build`, 5 integration tests, 9 e2e suites / 44 tests
