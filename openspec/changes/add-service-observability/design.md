## Context

The service ships with a central `LoggingInterceptor`, a central `AllExceptionsFilter` that logs 4xx and 5xx,
and no `console.log` anywhere — the plumbing for observability is in place, but what comes out of it is
unstructured text with no request identity, and nothing else is emitted at all. The 2026-07-26 QA review scored
the axis 7.0 and named the three gaps: no machine-readable logs, no correlation id, no metrics, no traces.

Constraints inherited from the existing design, all of which this change must respect:

- **Hexagonal layering.** `application/` and `domain/` may not import an infrastructure library. Anything that
  counts or traces from inside a use-case must go through a port.
- **D12, configuration.** Nothing reads `process.env` outside `config/`; everything is zod-validated and
  fail-fast, and nothing assumes `localhost` — the same code path runs locally and against managed services.
- **D8, fail-open caching**, and **D14, fail-over rate limiting.** Neither may acquire a new hard dependency.
- Lint enforces `max-lines: 250`, explicit return types and no `any`.
- CI runs e2e and integration suites against real Elasticsearch and Redis, and a **blocking** ZAP api-scan
  against the OpenAPI document. Nothing added here may require a collector to exist for those to pass.

## Goals / Non-Goals

**Goals:**

- Machine-readable logs that an aggregator can query, with one id tying every line of a request together.
- Enough metrics to answer the on-call questions: what is failing, how slow is it, is the cache working, has
  the rate limiter degraded.
- Traces that attribute latency to Elasticsearch, Redis or our own code, exported to a real backend.
- Coverage enforced rather than reported.
- The cheap QA-review findings closed while the files are already open.

**Non-Goals:**

- Log shipping, retention or alerting rules — JSON logs are the prerequisite for those, not a substitute, and
  the destination is an infrastructure and cost decision outside this change.
- Running a Prometheus instance or an agent. `/metrics` is exposed; who scrapes it is a deployment concern.
- Tracing the seed CLI, which is a batch command with no request lifecycle.
- SLO definitions and dashboards.

## Decisions

### D21 — pino installed as the Nest `LoggerService`, not `nestjs-pino`

Nest's `app.useLogger()` accepts any `LoggerService`, so a thin adapter over pino makes every existing
`new Logger(Context)` call site emit JSON with **no change to the ~30 call sites** and no new interceptor in
the request path. `NestFactory.create({ bufferLogs: true })` holds the bootstrap lines until the logger is
installed, so startup logs are structured too.

*Rejected:* `nestjs-pino`, which brings its own HTTP middleware and would log every request a second time
alongside the existing `LoggingInterceptor`, and pushes request context through a request-scoped provider.
*Rejected:* winston — heavier, slower, and its transport configuration is more machinery than this needs.

Local development keeps readable output by switching transport on `NODE_ENV`, so the format changes only where
a machine is reading.

### D22 — Correlation id in `AsyncLocalStorage`, not a request-scoped provider

The id must reach log statements that are made from static, non-injected positions (a use-case's private
logger, the exception filter). `AsyncLocalStorage` carries it implicitly across the whole async chain of the
request, so the pino adapter can stamp every record without any call site knowing the id exists.

*Rejected:* a request-scoped provider, which in Nest makes the entire injection subtree request-scoped —
instantiated per request, measurable overhead, and it would leak a transport concern into use-cases.
*Rejected:* threading the id through the port signatures, which puts an HTTP artifact into the domain-facing
contracts the whole architecture exists to keep clean.

The middleware that opens the store runs in `app.setup.ts`, so e2e boots exercise it exactly as production
does — consistent with D13.

### D23 — `/metrics` stays inside the rate limiter, outside the OpenAPI document, optionally token-protected

`/health` is exempt from rate limiting because the platform polls it as a readiness probe (D17). A metrics
scraper polls every 15–60 s, which is four requests a minute against a default budget of 120 — exemption would
buy nothing and would hand an unauthenticated endpoint an unlimited budget. So `/metrics` is **not** exempt.

It is excluded from the published OpenAPI document with `@ApiExcludeEndpoint`: the contract at `/docs` is what
a client of the search API needs, and an operations endpoint is not that. This also keeps the blocking ZAP
api-scan pointed at the client surface rather than fuzzing a text-format ops endpoint.

Because the endpoint is public by default, `METRICS_TOKEN` may be set to require a bearer token; unset, the
endpoint is open, which is the correct default for a portfolio deployment and the wrong one for a real
production service. The variable exists so that choice is a deployment decision, not a code change.

### D24 — Domain counters go through a `MetricsPort`; HTTP metrics come from an interceptor

`prom-client` is an infrastructure library, so `application/` may not import it. Cache hit/miss and rate-limit
fail-over are counted through a `METRICS_PORT` token whose adapter lives in `infrastructure/observability/`;
the RED metrics for HTTP come from a presentation-layer interceptor that already sees route and status. A
no-op adapter is bound when metrics are disabled, so call sites never branch.

*Rejected:* importing `prom-client` directly in `cacheAside` and the fail-over store — three lines shorter and
it would be the first inward-pointing dependency in the codebase.

### D25 — OpenTelemetry starts before Nest, reading the same validated schema, with a hand-picked instrumentation set

Instrumentation patches modules as they are required, so the SDK must start before `@nestjs/core`, Express,
ioredis or the Elasticsearch client are imported. The bootstrap therefore runs from the first import in
`main.ts`, before the application module is pulled in.

That is earlier than the DI container exists, so `APP_CONFIG` is not available. The bootstrap calls the **same
zod schema** from `config/env.schema.ts` rather than reading `process.env` ad hoc — `config/` remains the only
module that touches the environment, which is the point of D12, and an invalid sampling ratio still fails
startup.

Only `http` and `ioredis` are instrumented by us. **Elasticsearch needs no instrumentation package**: verified
during implementation, `@elastic/transport` carries `@opentelemetry/api` as a direct dependency and emits its
own spans whenever a tracer provider is registered (opt-out via `OTEL_ELASTICSEARCH_ENABLED=false`). There is
no `@opentelemetry/instrumentation-elasticsearch` on npm at all — the original plan named a package that does
not exist, and the client covering itself is the better outcome.

*Rejected:* `@opentelemetry/auto-instrumentations-node`, which registers dozens of instrumentations for
libraries this service does not use, enlarging both the image and the dependency surface that `npm audit` and
Dependabot must keep clean.

With `OTEL_EXPORTER_OTLP_ENDPOINT` unset the SDK is never started: no exporter, no spans, no overhead. This is
what keeps CI, the e2e suites and local development free of any collector requirement, and it mirrors how the
Elasticsearch client already picks auth and TLS from the environment.

### D26 — Single-flight in-process, never a distributed lock

`cacheAside` keeps a map of in-flight loads keyed by cache key: the first miss starts the load, concurrent
callers await the same promise, and the entry is removed when it settles. Per instance rather than per cluster,
so N instances still make at most N upstream calls instead of N × concurrency.

*Rejected:* a Redis-based mutex. It would make the cache path depend on Redis being available to make
progress, which is exactly the coupling D8 removed — an outage would turn a degraded-but-working service into
a stalled one.

TTL jitter of ±10 % is applied on write so entries populated in the same burst do not expire in the same
second and re-stampede together.

### D27 — Cached payloads are validated before being served

The cache currently `JSON.parse`s whatever is stored and returns it as the response type, so a shape change
without a namespace bump is served to clients as if it were valid. Parsing the cached value against a zod
schema — zod is already a production dependency — turns that from an operational discipline into a property of
the code: a mismatch is treated as a miss and reloaded.

*Rejected:* storing a shape hash alongside the payload, which is cheaper but only detects changes the writer
declared, not corruption or a partially written value.

The cost lands on the cache-hit path, which is the fastest path in the service (4.65 ms p95). It must be
measured rather than assumed — see Risks.

### D28 — `Cache-Control` on search responses matches the server-side TTL

Search responses already sit in Redis for a configured TTL; saying so to clients costs nothing and lets a
browser or CDN avoid a round-trip. Search results get `public, max-age=<search cache TTL>`; `/health` and
`/metrics` get `no-store`, because a cached readiness probe or a cached counter is worse than useless.

The trade-off is that an edge cache may serve a response the rate limiter never counted. Acceptable here: the
index is read-only and seeded, so a stale page of results is not a correctness problem, and Render's CDN does
not cache JSON without an explicit rule.

### D29 — Coverage thresholds are set from the measured baseline

Thresholds go a hair under the values measured on the day (97.83 % statements, 88.21 % branches, 97.93 %
functions): high enough to block a regression, not so high that an honest refactor fails the build. CI's
`quality` job runs `test:cov` **instead of** `npm test`, since it runs the same suite and adds the gate.

*Rejected:* aspirational thresholds like 100 % branches, which teach a team to disable the gate.

## Risks / Trade-offs

- **The warm cache path gains work** (ALS lookup, a counter, a zod parse) → the k6 battery must be re-run
  before anyone repeats the 4.65 ms p95 figure. If the parse dominates, D27 falls back to the shape-hash
  alternative. The claim is not to be inherited from the old report.
- **Three new dependency trees** (pino, prom-client, OTel) enter the `npm audit` surface → audit stays at 0 as
  a merge gate, Dependabot already watches npm, and the hand-picked instrumentation set keeps the OTel tree as
  small as it can be.
- **OTel http instrumentation could double-count with `LoggingInterceptor`** → they measure different things
  (a span versus a log line) and the interceptor stays the source of the log; no metric is derived from both.
- **`/metrics` is public by default** → it discloses route names and counts, nothing about payloads or
  clients; `METRICS_TOKEN` closes it where that matters. Excluding it from the OpenAPI keeps it out of the
  documented attack surface without pretending it is hidden.
- **Bootstrap ordering is fragile**: an import added above the tracing bootstrap in `main.ts` silently disables
  instrumentation → the bootstrap file carries a comment saying so, and the ordering is asserted in a unit test.
- **The inverted price range becomes a 400** → a client relying on the previous empty-result behaviour breaks.
  It is documented as breaking in the proposal, and the previous behaviour was indistinguishable from a
  genuinely empty catalogue, which is the reason for the change.

## Migration Plan

1. Ship with everything inert: no OTLP endpoint, no metrics token. The service behaves as it does today apart
   from the log format, `/metrics` and the fixes.
2. Add `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` on Render as secrets once the Grafana
   Cloud account exists. Tracing begins with no redeploy of code.
3. Point a scraper at `/metrics` when there is one; set `METRICS_TOKEN` at the same time.

Rollback is a revert: no data migration, no index change, no stored state introduced.

## Open Questions

- **Grafana Cloud credentials** are pending from the user. Everything is built and tested with the exporter
  inert; the endpoint and token are pasted into Render when they exist. This does not block implementation.
- **Sampling ratio in production** starts at 10 %. Whether that is enough signal on a free tier with low
  traffic is a question the first week of data answers, not this document.
