## Why

The service emits three signals and only one of them leaves the machine. Verified against the deployed
service and Grafana Cloud (stack `lankycliff422`) on 2026-07-27:

| Signal | Where it is | Where it can be read |
|---|---|---|
| Traces | exported over OTLP | Tempo — working, Elasticsearch spans included |
| Metrics | `GET /metrics`, in-process registry | **nowhere** — nothing scrapes it |
| Logs | pino JSON on stdout | **nowhere** — Loki holds no `service_name` for this service over 24 h |

So the two signals that answer *"is the cache earning its keep"*, *"did the rate limiter fail over"* and
*"what did the request that failed at 03:00 actually do"* are only readable by someone holding the metrics
bearer token and shelling into a log tail, and both vanish when the Render instance restarts. The service is
in real use by its owners, which is what makes this worth closing now rather than at the next incident.

A second, narrower gap was found by the same check: **Redis produces no spans at all** — zero across a full
day, on a complete Tempo query, while Elasticsearch spans are present. The cause is load ordering rather than
configuration (see design), so a trace of `/search` today shows the Elasticsearch call and silently omits the
cache lookup that decided whether that call happened. That makes the traces we *do* ship misleading, so it is
fixed here rather than filed separately.

## What Changes

- **Metrics reach Grafana Cloud.** The existing prom-client registry (`http_requests_total`,
  `http_request_duration_seconds`, `search_cache_events_total`, `rate_limit_failover_total`) becomes readable
  in Grafana, without moving any call site off `METRICS_PORT` and without exposing `/metrics` any wider than
  it is today.
- **Logs reach Grafana Cloud.** pino's JSON lines land in Loki with the correlation id preserved as a
  queryable field, so a trace id seen in Tempo can be pivoted to the lines it produced.
- **Redis is traced.** The ioredis instrumentation actually patches the client, so a `/search` trace shows the
  cache lookup alongside the Elasticsearch query.
- **The shipping path is configuration, not a code path per environment.** Everything stays inert when the
  new variables are unset, exactly as `OTEL_EXPORTER_OTLP_ENDPOINT` already does — CI, the e2e suites and a
  local run must keep working with no backend in sight.
- Not in scope, on purpose: **alerting** (what pages whom is a separate decision, and needs the data to exist
  first), dashboards, and any change to what the service measures. This change moves existing signals; it
  does not add new ones.

## Capabilities

### New Capabilities

- `telemetry-shipping`: how metrics and logs leave the process for an external backend — what is shipped,
  under what identity, what happens when the backend is unreachable, and the guarantee that an unconfigured
  deployment ships nothing and still boots.

### Modified Capabilities

- `service-observability`: the tracing requirement gains the guarantee that **every instrumented dependency is
  actually instrumented**. Its existing scenario already demands child spans for Elasticsearch *and Redis*, and
  production satisfies only half of it — the requirement is worded in a way that can pass on paper while a
  dependency emits nothing, so it gains the load-order guarantee and a scenario that fails when a client is
  loaded before instrumentation registers. Export itself belongs to `telemetry-shipping`; `GET /metrics` and
  its protection are unchanged.

## Impact

- **Code**: `src/main.ts` (module load order is the Redis bug), `src/infrastructure/observability/`
  (a shipping adapter behind the existing tokens, the tracing bootstrap), `src/config/env.schema.ts` and
  `app-config.ts` (new optional variables, validated and fail-fast like the rest).
- **Deployment**: new environment values on Render; no new always-on service. The free tier bills 750
  instance-hours a month across the workspace and the keep-alive already consumes ~730, so a design that
  needs a second running container is not deployable here and the design must say so rather than assume an
  agent.
- **Cost**: Grafana Cloud free tier — the design states the expected series count and log volume before
  anything is switched on.
- **Docs**: `README.md` env table, `docs/OBSERVABILITY-2026-07-27.md` (its "Deferred, on purpose" section
  names both of these as deferred and stops being true), and the observability bullet in `CLAUDE.md`.
- **Security**: whatever reads `/metrics` holds `METRICS_TOKEN`; the endpoint stays inside the rate limiter,
  so its budget has to fit the scrape interval. No new public surface.
