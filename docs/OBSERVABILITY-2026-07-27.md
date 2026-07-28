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

**A correction worth recording.** The first version of this report claimed tracing "exported cleanly" during
the load test because the application log showed no exporter error. That was not evidence: OpenTelemetry's
diagnostic logger is off by default, so a rejected export is silent. Checked properly against Grafana Cloud's
OTLP gateway, the header we were sending was **401**:

```
POST /otlp/v1/traces  Authorization: Basic%20<base64>   -> 401
POST /otlp/v1/traces  Authorization: Basic <base64>     -> 200
```

Grafana's console hands you `Authorization=Basic%20…`, and the OpenTelemetry environment-variable
specification says header values are percent-encoded and must be decoded. `parseOtlpHeaders` was not decoding
them, so no span ever reached the backend during that run.

**Fixed and verified end to end.** With decoding in place, a local OTLP collector receives what the process
actually sends:

```json
{"method":"POST","url":"/v1/traces","auth":"Basic MTczOD…",
 "authHasLiteralPercent":false,"contentType":"application/json","bytes":6454}
```

Both halves are now proven separately: the gateway accepts the decoded credential (200), and the exporter
emits the decoded credential (no literal `%` in the header it sends).

**Probes are dropped at the sampler.** Within minutes of the exporter going live, Grafana showed the trace list
filling with 62–74 ms `GET` spans a few seconds apart: Render's probing of `/health` plus the container's own
30 s `HEALTHCHECK`, all sampled at 100 %, drowning the handful of real searches in the window around a deploy.
(This paragraph first read "every 5–30 seconds … thousands of identical traces a day". That extrapolation was
wrong — see the correction under "Post-deploy check against the live backend".)
`IgnoredPathsSampler` returns `NOT_RECORD` for server spans on `/health` and
`/metrics`, and because the decision is taken at the **root**, `ParentBasedSampler` drops the child spans with
it. An `ignoreIncomingRequestHook` would not have done: it suppresses only the server span, and the health
probe's own Elasticsearch and Redis calls would then have been exported as parentless orphans — one useless
trace turned into two useless spans.

Verified against the local collector: **20 requests to `/health` and 5 to `/metrics` produced zero exports**;
two `/search` requests immediately after produced one, of 5501 bytes.

**Known limitation.** Spans are flushed on a ~5 s batch schedule and on `SIGTERM` via `sdk.shutdown()`. The
shutdown flush is asynchronous and races the process exit, so a redeploy can drop the last few seconds of
traces. Acceptable for this service; worth knowing before anyone debugs a gap around a deploy.

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
| Trace auth | `curl` against the Grafana OTLP gateway | **200** decoded, **401** percent-encoded |
| Trace export | booted build + local OTLP collector | `POST /v1/traces`, 6454 bytes, header decoded |

## Operating decisions, and when to revisit them

The service is at the start of real use, not a demo, so these are settings with a trigger rather than
preferences.

**Sampling stays at 1.0 for now.** Probes are dropped at the sampler, so what remains is genuine traffic, and
it is measured in tens of requests a day. Head-based sampling at 10 % would mean that nine times out of ten the
slow request someone asks about was never recorded — the opposite of why tracing exists.

**When to lower it, computed rather than guessed.** One trace of this service measures **2751 bytes** of
uncompressed OTLP JSON (measured: a 5501-byte export carrying two `/search` traces, each a server span plus its
Elasticsearch and Redis children). Against Grafana Cloud's free 50 GB/month that is:

| | |
|---|---|
| Traces within the free tier | ~19.5 million/month |
| At ratio 1.0 | **~650,000 requests/day** |
| Sustained rate | **~7.5 req/s** |

So 1.0 holds until traffic approaches roughly 7 req/s sustained. It is an environment variable, so changing it
costs a redeploy and no code.

**What to do instead of just lowering it.** A head-based ratio discards errors and slow requests at exactly the
same rate as boring ones, which is backwards. The production-grade move at that point is **tail sampling** —
keep 100 % of errors and anything over a latency threshold, sample the rest — which needs an OpenTelemetry
Collector between the service and Grafana. The exporter already speaks OTLP, so that is a change of endpoint,
not of code.

**Now measured: full sampling costs nothing detectable.** The battery was run twice against the same stack,
once at the 0.1 default and once at 1.0, with the SDK loaded and exporting in both, reading
`process_cpu_seconds_total` from `/metrics` before and after each run:

| | ratio 0.1 | ratio 1.0 |
|---|---|---|
| CPU seconds consumed | 199.95 | **199.36** |
| Requests served | 298,743 | **321,660** |
| CPU per 1,000 requests | 0.669 s | **0.620 s** |
| Failed requests | 0.000 % | 0.000 % |
| p95 spread across the seven scenarios | — | −3.70 ms to +0.35 ms |

The full-sampling run used marginally *less* CPU while serving 8 % more requests, and its p95 came out lower in
five scenarios of seven. Read honestly, that does not mean tracing everything is free — it means the cost is
**below what this method can resolve**, with run-to-run variance dominating. The decision it settles is the one
that mattered: nothing here argues for sampling less than 1.0 at this volume.

**`/metrics` is closed.** It is protected by `METRICS_TOKEN`: without the bearer it answers 401. The endpoint
discloses route names, request volumes, error rates and cache behaviour — fine to leave open on a demo, not on
a service that is actually used, which is what this became.

**Probe log lines are skipped too.** The deployed log fills with `GET /health 200 6xms` around a deploy, at a
few seconds apart, and the keep-alive adds its own on a 10-minute tick for as long as the service runs. Every
one of them says the same thing. (This paragraph first claimed Render polls every 5 seconds, "17,280 lines a
day". It does not — see the correction under "Post-deploy check against the live backend". The decision below
is unaffected: a line per poll saying "still fine" is noise at any of these volumes.)
`LoggingInterceptor` now skips successful operator paths, which costs
nothing: it runs on `tap`, so it only ever saw successes, and a failing probe still goes through
`AllExceptionsFilter` — a 503 from `/health` or a 401 from `/metrics` is logged exactly as before.

Verified on the deployment: in the window after the deploy went live, the only application log line is the one
real `/search` request, with `/health` polls and a manual `/health` producing none.

## Post-deploy check against the live backend

Everything above was verified against a local collector. This section is the same questions asked of Grafana
Cloud (stack `lankycliff422`) once the service had been running on Render for a few hours.

**Three things confirmed in production.** Traces arrive under `service.name=advanced-search-api` with the full
resource (`process.command=/app/dist/main.js`, node 26.5.0). Elasticsearch needs no instrumentation package, as
claimed: in trace `015ce976…` the child span comes from scope `@elastic/transport 8.10.2`, carrying
`db.system=elasticsearch` and `db.operation.name=ping`, parented to the HTTP server span. And the probe sampler
works — **zero** `/health` or `/metrics` traces between 17:00Z and 23:45Z, a complete Tempo query over the
6 h 45 since `c52e25d` was deployed. The pre-fix traces are still in the store for contrast: the one at
15:29:24Z is `url.path=/health`, `user_agent.original=Render/1.0`, 68.96 ms, server span plus the probe's own
Elasticsearch ping — exactly the shape the sampler was written against.

**One defect: an OTLP metrics pipeline nobody declared.** Grafana Cloud's Prometheus held a
`job="advanced-search-api"` with seven series names — `http_server_request_duration_seconds_{bucket,count,sum}`,
the `http_client_*` equivalents, and `target_info`. None of them come from `/metrics`: no `process_*`, no
`nodejs_*`, and none of the two counters this service actually cares about. They came from the tracing
bootstrap. `NodeSDK` only reads `metricReaders` from the caller if the option is present; left unset it falls
back to `getMetricReadersFromEnv()`, whose exporter defaults to **otlp** when `OTEL_METRICS_EXPORTER` is empty
(`@opentelemetry/sdk-node/build/src/sdk.js:27-54,147`). Setting `OTEL_EXPORTER_OTLP_ENDPOINT` for *tracing*
therefore started a second pipeline as a side effect.

The measurement that proves it is not trace-derived: over one hour,
`increase(http_server_request_duration_seconds_count[1h])` reported **213.9 requests, all status 200**, in a
window where Tempo held **no client traces at all**. Those 213 are the probes — dropped from traces at the
sampler, still counted by the HTTP instrumentation's histogram. Had the metrics been generated from spans, the
number would have been zero.

It was harmless but wrong on three counts: it spends Grafana Cloud series on a free tier, it contradicts the
rule that metrics leave through `METRICS_PORT`, and the data is not even usable — with no Express
instrumentation there is no `http_route` label, so it cannot answer anything per endpoint.

**Fixed by declaring the opt-out.** `buildTracingConfig` now passes `metricReaders: []`. Present-and-empty is
not the same as unset: the SDK skips constructing the `MeterProvider` entirely when the reader list is empty
(`sdk.js:182-184`), so there is no global meter provider and no exporter. The config is built by a function
apart from the SDK so a spec asserts the empty list directly, which is what stops this from silently coming
back on an SDK upgrade.

**Also confirmed, and already deferred below**: no logs reach Loki (`service_name` has no values over 24 h) and
nothing scrapes `/metrics`. Both remain infrastructure decisions, not defects.

### Correction: Render does not poll `/health` every 5 seconds

Two paragraphs above stated that Render polls `/health` every 5 seconds — 17,280 requests a day. **That is
wrong by more than two orders of magnitude**, and the arithmetic built on it (that the readiness probe alone
would exhaust Upstash's 500,000 commands a month) was wrong with it.

Measured on the Upstash console, 2026-07-28: the database served **3,100 commands this month** against the
500,000 free-tier allowance. Every `/health` costs exactly one Redis `PING`
(`redis.health-probe.ts`), and that 3,100 also covers every cache read and write from real search
traffic — so `/health` cannot have been called more than ~3,100 times in the month, around 115 a day. At a
5-second poll it would have been ~518,000.

The error was in reading the evidence, not in the arithmetic. Both the log lines and the Tempo traces showing
probes a few seconds apart were **clustered in short windows around deploys**; extrapolating that spacing
across 24 hours produced a number 170× too large. Render's health check is concentrated on deployment, not a
continuous liveness poll. What actually calls `/health` around the clock is the keep-alive cron, six times an
hour, which on its own accounts for very nearly the whole measured figure.

Nothing built on top of the wrong number needs undoing: dropping probe traces at the sampler and skipping
probe log lines are right at any of these volumes. What does change is a conclusion drawn later — that the
unauthenticated, unthrottled `/health` was actively burning the Redis quota. It is not. It remains an endpoint
worth hardening on its own merits, and nothing more urgent than that.

## Deferred, on purpose

- **Log shipping and alerting.** JSON logs are the prerequisite, not the solution. Where the lines go, how long
  they are kept and what pages someone at 3 a.m. are deployment and cost decisions.
- **A scraper for `/metrics`.** The endpoint is real; running Prometheus or a Grafana agent against it is
  infrastructure this repo does not own.
- **The remaining minor findings** from the QA review's §5 that were not in scope here: `POST /search`
  answering 404 rather than 405.
