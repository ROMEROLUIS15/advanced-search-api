## 1. Redis instrumentation (design D37) — lands and is verified alone

- [ ] 1.1 Extract everything `main.ts` does after `startTracing()` into `src/app.bootstrap.ts`, so the entry
      point statically imports nothing but `reflect-metadata` and the tracing bootstrap
- [ ] 1.2 Reach the application through `await import('./app.bootstrap')` in `main.ts`, after `startTracing()`
- [ ] 1.3 Replace the `main.ts` import-order spec: assert that no application module is statically imported and
      that the app is loaded dynamically — the current spec encodes the broken shape and would pass it
- [ ] 1.4 Add a spec proving `ioredis` is required only after instrumentation registers (assert on load order,
      not on a live Redis)
- [ ] 1.5 Run the gate (`lint:ci`, `test:cov`, `build`), commit, deploy, and confirm in Tempo that a `/search`
      trace now carries a `db.system=redis` span — the check that failed on 2026-07-27

## 2. Configuration for both pipelines (design D38)

- [ ] 2.1 Add the metrics-export and log-shipping variables to `env.schema.ts`, optional and validated, so a
      malformed endpoint fails startup
- [ ] 2.2 Map them into `ObservabilityConfig` in `app-config.ts`; nothing reads `process.env` outside
      `load-config.ts`
- [ ] 2.3 Extend the boot line in `main.ts` to report each pipeline as active or inactive, not just tracing
- [ ] 2.4 Specs: unset ⇒ inert; malformed ⇒ startup failure naming the variable; one pipeline configured leaves
      the other unconstructed

## 3. Metrics export (design D35)

- [ ] 3.1 Add `@opentelemetry/exporter-metrics-otlp-http` and `@opentelemetry/sdk-metrics` at the version line
      already pinned for the OTel packages; keep `npm audit` at 0
- [ ] 3.2 In the observability adapter, build a `MeterProvider` with a `PeriodicExportingMetricReader` +
      `OTLPMetricExporter` when configured — and **do not** register it globally (that is what keeps the
      instrumentation histograms removed in `1452e7b` from coming back)
- [ ] 3.3 Record each `MetricsPort` method into both its prom-client and its OTel instrument, in the same method
- [ ] 3.4 Leave `GET /metrics`, its token and its OpenAPI exclusion untouched; the no-op adapter still branches
      nowhere
- [ ] 3.5 Specs: each port method touches both registries; nothing is constructed when unconfigured; the global
      meter provider is never set; an unreachable backend fails no request
- [ ] 3.6 Verify against Grafana Cloud that the four declared series arrive **and** that no
      `http_server_request_duration_seconds` reappears

## 4. Log shipping (design D36)

- [ ] 4.1 Add `pino-loki` and wire it as a transport target in `PinoLoggerAdapter`, only when configured
- [ ] 4.2 Keep stdout as a destination alongside it, so Render's own log view stays populated
- [ ] 4.3 Set labels to `service` and `env` only; keep `correlationId` a field, with the cardinality reason
      written where the labels are
- [ ] 4.4 Swallow transport errors inside the adapter — an unhandled rejection here reaches
      `installProcessSafetyNet`, which exits the process
- [ ] 4.5 Specs: a failing transport neither rejects nor reaches the safety net; the correlation id is present
      as a field on a shipped line; the `destination` injection specs keep working
- [ ] 4.6 Verify in Loki: a line from a real request, then pivot from a Tempo trace to its `correlationId`

## 5. Measure what was estimated (design "Risks")

- [ ] 5.1 Record the actual active series count against the ~400 estimate, and the log volume per day against
      the <10 MB/month estimate
- [ ] 5.2 If either exceeds the free tier, fall back to the option named in D35 (scrape from the keep-alive
      cron and `remote_write`) rather than inventing a new one

## 6. Documentation

- [ ] 6.1 Update `docs/OBSERVABILITY-2026-07-27.md`: its "Deferred, on purpose" section names both of these and
      stops being true; record the measured numbers from group 5
- [ ] 6.2 Add the new variables to the README env table
- [ ] 6.3 Update the observability bullet in `CLAUDE.md` — the Redis load-order rule and the two new pipelines
- [ ] 6.4 Run the full gate and the e2e/integration suites with no backend configured, proving the inert path
