## Context

Observability was built in `2026-07-27-add-service-observability` (D21–D29) and shipped complete *inside* the
process: pino JSON on stdout, a prom-client registry at `GET /metrics`, OTLP traces. Only the traces were ever
given somewhere to go. Confirmed against the running system on 2026-07-27:

- **Tempo** holds spans for `service.name=advanced-search-api`, Elasticsearch children included, probe paths
  correctly absent since the sampler fix.
- **Prometheus** holds no series from this service. The seven that were there
  (`http_server_request_duration_seconds` and friends) came from an OTLP metrics pipeline the NodeSDK started
  from the environment without anyone declaring it, removed in `1452e7b`.
- **Loki** has no `service_name` values over 24 h.
- **No span carries `db.system=redis`** — zero over a full day, on a query that completed all 12 blocks —
  although `/search` reads Redis on every request and the health probe pings it every 5 s.

Two constraints are not negotiable and rule out the textbook answer:

1. **No second always-on container.** Render's free tier bills 750 instance-hours a month *across the
   workspace*; the keep-alive cron keeps this service awake ~730 of them. A Grafana Alloy agent as a second
   free service puts the workspace over quota, and Render suspends services when that happens.
2. **Render cannot ship the logs either.** Log streaming requires a **Pro workspace or higher**, and Loki is
   not among the supported destinations (HTTPS: Datadog, Loggly; everything else is TLS syslog). Verified in
   Render's own documentation, not assumed.

So both signals have to leave from inside the process, which is the same conclusion the tracing exporter
reached, and the design question is only *how* without breaking the boundaries the codebase already keeps.

## Goals / Non-Goals

**Goals:**

- The four business metrics (`http_requests_total`, `http_request_duration_seconds`,
  `search_cache_events_total`, `rate_limit_failover_total`) are queryable in Grafana Cloud.
- pino's lines are queryable in Loki with `correlationId` preserved, so a trace can be pivoted to its logs.
- Redis spans appear in traces, so a `/search` trace shows whether the cache was consulted.
- With the new variables unset, the process behaves exactly as today: no exporter, no transport, no worker,
  no network. CI, the e2e suites and a local run must not need a backend.
- Call sites keep recording through `METRICS_PORT`. Nothing outside `infrastructure/observability/` learns
  that an exporter exists.

**Non-Goals:**

- Alerting and dashboards. They need the data to exist first and are a separate decision.
- New measurements. This change moves the signals that already exist; it does not add instruments. (The known
  gap that guard rejections — 401/429 — never reach `MetricsInterceptor` is real and **out of scope here**.)
- Replacing prom-client, or changing anything about `GET /metrics`. The load test, the DAST job and local
  debugging all read it.

## Decisions

### D35 — Metrics leave over OTLP, through a MeterProvider the metrics adapter owns

The observability adapter gains a `MeterProvider` with a `PeriodicExportingMetricReader` and an
`OTLPMetricExporter`, reusing the `OTEL_EXPORTER_OTLP_ENDPOINT` / `OTEL_EXPORTER_OTLP_HEADERS` already
configured and proven. Each `MetricsPort` method records to its prom-client instrument **and** its OTel
instrument, in one place; `/metrics` is unchanged.

Critically, this provider is **not** registered as the global one. Instrumentation packages resolve their
meters from the global provider, so leaving it unset is what keeps the HTTP instrumentation's histograms out —
the exact series removed in `1452e7b` — and lets `metricReaders: []` on the NodeSDK stand. The two decisions
are consistent, not contradictory: nothing exports *by accident*; this exports *by declaration*.

| Alternative | Why not |
|---|---|
| Re-enable the NodeSDK's env-driven metric reader | Brings back the undeclared HTTP histograms wholesale and puts export outside the `METRICS_PORT` boundary. It is the bug, re-committed. |
| Prometheus `remote_write` from the app | Needs snappy + protobuf encoding and a second credential (push URL + user id) for the same result; the maintained-library situation is thin. |
| Grafana Alloy scraping `/metrics` | Not deployable: the 750 h workspace quota (constraint 1). |
| Scrape `/metrics` from the keep-alive GitHub Actions cron and `remote_write` | Free and needs no service, but 10-minute resolution and CI as a data path. **Kept as the fallback** if OTLP metrics turn out to cost more than the free tier allows. |
| Drop prom-client, serve `/metrics` from OTel's `PrometheusSerializer` | Single source of truth, but renames every series (unit suffixes, `_total`, `target_info`) and breaks the load-test report, the docs and the DAST expectations to fix something nobody is suffering from. |

Recording twice inside one adapter is the cost of this decision, and it is deliberate: it is four lines in one
file, invisible through the port, and reversible.

### D36 — Logs ship from the process with a pino transport, because the platform cannot

`pino-loki` as a pino transport target, which runs in a **worker thread**: batching and HTTP stay off the
event loop, and stdout keeps receiving the same JSON so Render's own log view does not go dark.

Labels are `service` and `env` only. **`correlationId` stays a field, never a label** — it is unique per
request, and promoting it would create one Loki stream per request, which is the classic way to be throttled
off a free tier in an afternoon.

| Alternative | Why not |
|---|---|
| Render log stream | Requires a Pro workspace; Loki is not a supported destination. Verified, not assumed. |
| Alloy tailing the container | Constraint 1 again. |
| A second `pino.multistream` writing HTTP inline | Puts network I/O on the main thread for every log line. |

**Fail-open is a hard requirement, not a nicety.** A Loki outage must not take the service down — and the risk
is concrete: an unhandled rejection from the transport reaches `installProcessSafetyNet`, which by design logs,
closes the app and calls `process.exit(1)`. A logging backend going down would restart the API. The transport
must therefore swallow its own errors, and a spec has to prove it.

### D37 — Redis is untraced because of module load order, and the fix is a dynamic import

`main.ts` imports `AppModule` at module scope. Static imports are evaluated before `bootstrap()` runs, so
`ioredis` is required *before* `startTracing()` registers the instrumentation. `require-in-the-middle` patches
on `require`, and nothing requires `ioredis` a second time, so `Redis.prototype.sendCommand` is never wrapped.
HTTP survives only by luck: `http` is required again later by Express and Nest, after the patch is in place.

The fix is to keep `startTracing()` first and load the application **dynamically** afterwards:
`await import('./app.bootstrap')`. Nothing that touches a client is a static import of `main.ts` any more.

The existing spec that asserts `main.ts`'s static import order has to be replaced, not extended: it currently
encodes the broken shape and would fail the fix. The replacement asserts that no application module is
statically imported above the tracing bootstrap and that the app is reached through a dynamic import.

| Alternative | Why not |
|---|---|
| `node --require ./dist/tracing.preload.js` in the Dockerfile | Works, but moves a load-bearing detail into the container command, where `npm start` locally silently differs from production. |
| Accept it and document it | The trace would keep omitting the cache lookup that decides whether Elasticsearch is queried at all — a trace that lies by omission is worse than no trace. |

### D38 — Everything stays inert until configured, and says which pipelines are live

Each pipeline switches on from its own optional, zod-validated variable, exactly as
`OTEL_EXPORTER_OTLP_ENDPOINT` does today: metrics export follows the OTLP endpoint plus an explicit
`OTEL_METRICS_EXPORT_ENABLED`; log shipping follows `LOKI_URL` plus its credentials. Unset means not
constructed — no worker, no exporter, no timer. The boot line that already reports tracing on/off reports all
three, because "is it actually shipping" should never be inferred from an empty dashboard.

## Risks / Trade-offs

- **The log transport crashes the process** → transport errors are swallowed inside the adapter, and a spec
  asserts that a failing Loki write neither rejects nor reaches the process safety net.
- **The two metric registries drift** (a new instrument added to one and not the other) → both are written in
  the same `MetricsPort` method, and a spec asserts each method touches both.
- **One credential now carries two signals**: a bad OTLP token breaks traces *and* metrics → the boot line
  reports each pipeline separately, so the failure is visible without a dashboard.
- **Free-tier limits are estimated, not measured** → estimate is ~400 active series (dominated by the
  duration histogram's buckets × route × status) against 10k free, and well under 10 MB/month of logs at
  current traffic now that probe lines are skipped. A task measures both against the real backend before this
  is called done; the fallback in D35 exists for the case where the estimate is wrong.
- **Cost of double bookkeeping** → accepted, and contained to one file. If prom-client is ever dropped,
  `/metrics` is the only consumer to migrate.
- **Loki label cardinality** → labels fixed to `service` and `env`; `correlationId` deliberately a field. A
  reviewer changing that would silently blow the ingest limit, so the reason is written where the labels are.

## Migration Plan

1. Ship the code with every new variable unset. Production behaviour is byte-identical; CI and e2e stay
   backend-free. This is independently verifiable before any credential exists.
2. Fix D37 and confirm in Tempo that a `/search` trace now carries a `db.system=redis` span. This is the one
   step that changes existing behaviour, so it lands and is verified alone.
3. Enable metrics export on Render. Verify the four series in Grafana Cloud and record the actual series
   count against the estimate.
4. Enable log shipping. Verify a line in Loki, then pivot from a Tempo trace to its `correlationId`.
5. Update `docs/OBSERVABILITY-2026-07-27.md` — its "Deferred, on purpose" section names both of these and
   stops being true — the README env table, and the observability bullet in `CLAUDE.md`.

**Rollback** is per pipeline and needs no code: unset the variable and redeploy. The D37 fix is the exception,
being a code change; it is a revert of one commit and carries no data or schema consequence.

## Open Questions

- Does Grafana Cloud's free tier accept OTLP **metrics** on the same gateway as traces with the same token,
  or does it need a separate endpoint? Step 3 answers it before anything depends on it.
- Should `GET /metrics` remain once the data is in Grafana? Keeping it costs nothing and the load test reads
  it, so the assumption is yes — revisit only if it becomes a second thing to secure rather than one.
