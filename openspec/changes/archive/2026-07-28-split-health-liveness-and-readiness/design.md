## Context

`GET /health` serves three audiences that were never separated: Render's health check, which polls it every
**~4.3 s** to decide whether to route traffic and whether a deploy succeeded; an external UptimeRobot monitor
every 5 minutes; and a human reading it. One endpoint, one fan-out over every probe, for all three.

The poll rate is measured, not assumed — `increase(http_requests_total{route="/health"}[5m])` = 70.0 in
steady state, away from any deploy window — and the Render blueprint exposes no interval setting, so the
frequency is a constant of the environment. The only lever is what a single poll costs.

Today a poll costs one Redis `PING` and one Elasticsearch `indices.exists`, run in parallel by
`CheckHealthUseCase`. That is ~605,000 Upstash commands a month against a 500,000 free-tier allowance.

Two facts shape the design and neither is negotiable:

1. **Readiness must keep proving the index exists.** Since 2026-07-28 a reachable Elasticsearch with a
   missing index reports down, which is what makes Render fail a deploy against an unseeded cluster instead
   of routing traffic to a service that answers 503 to every search. Any endpoint the platform polls has to
   keep that property.
2. **The platform cannot authenticate.** Render's health check sends no headers we control, so whatever it
   polls stays reachable without credentials.

## Goals / Non-Goals

**Goals:**

- Take health-driven Redis traffic to zero without weakening what readiness proves.
- Keep `GET /health` byte-identical in body, status rule and headers — the monitor, the e2e suite and the
  README all depend on it.
- Make the "what does a platform poll cost" question answerable in one place, so the next dependency added
  to the health report does not silently become a 20,000/day bill.
- Close the substance of the roadmap's `/live` vs `/ready` item rather than deferring it again.

**Non-Goals:**

- Reducing Elasticsearch polling. Readiness still calls `indices.exists` ~20,000 times a day. The call is
  metadata-only and cheap, but its cost against Elastic Cloud is **unmeasured**; measuring it is in scope,
  acting on it is not.
- Authenticating or rate-limiting the health family. The platform constraint rules it out for readiness, and
  the others are worth no more than readiness is.
- Changing Redis's non-critical status, the fail-open cache, or anything about how search behaves.

## Decisions

### D39 — Readiness evaluates the critical probes only, by criticality rather than by name

`GET /health/ready` runs the probes already marked `critical`, which today means Elasticsearch alone. The
rule is stated in terms of the property, not the dependency: **a continuously polled endpoint must not call a
dependency whose state cannot change its answer.**

Redis is non-critical by design — `CheckHealthUseCase` computes `healthy` as "every critical dependency is
up", so a Redis `PING` result is discarded on every one of the 20,000 daily polls. Calling it was never
wrong, merely free; it stopped being free the moment the instance stayed awake around the clock.

Selecting by criticality rather than hardcoding "skip Redis" means a second critical dependency added later
is picked up by readiness automatically, and a second non-critical one never lands on the polled path. The
probe list already carries the flag, so this costs a filter and no new concept.

| Alternative | Why not |
|---|---|
| Memoize the whole report for 30–60 s | Cuts both dependencies ~14× and keeps a real `PING`, but leaves readiness reporting state up to a minute stale and needs an argument against the spirit of D28 on every future read. The split removes the cost rather than amortising it, and staleness is a worse trade for a deploy gate than for a dashboard. |
| Replace the `PING` with ioredis's connection status | Zero commands, but the `PING` every 4.3 s is an accidental keepalive: with real traffic this low the connection would go idle, Upstash would drop it, and a status-based probe would flap through every reconnect — trading a quota problem for a noisy one. |
| Ask Render to poll less often | Not exposed in the blueprint or the dashboard. |

### D40 — The new endpoints live under `/health/`, which is what makes the exemptions free

`/health/ready` and `/health/live`, not top-level `/ready` and `/live`. `matchesPath` already matches a
prefix **or any sub-path of it** against `OPERATOR_PATHS`, and four independent places consume that one
list: the API-key guard, the rate limiter's `skipIf`, the trace sampler and the request logger. Nesting the
new routes under the existing prefix means all four apply to them on the day they exist, with no edit to
`operator-paths.ts` and no chance of a fifth consumer being missed later.

Top-level paths would require adding two entries to that list — safe today, and exactly the kind of edit
that gets half-done when a sixth consumer appears. Verified in the code before choosing, not assumed:
`matchesPath('/health/ready', OPERATOR_PATHS)` is true by the existing sub-path rule, and the spec's
"different route sharing a prefix" case (`/healthy-products`) still correctly does not match.

### D41 — Render polls `/health/ready`, not `/health/live` — the roadmap's sketch was wrong

The item this closes proposed splitting `/live` from `/ready` and "keeping only `/live` fully open". That
does not survive contact with the platform: Render's check is what gates deploys, so if it polled a
dependency-free `/live`, an unseeded deployment would go **live** and serve 503s to real clients instead of
failing the deploy — losing the property added deliberately days earlier. And `/ready` cannot be closed off,
because Render cannot present a credential.

So both stay open, and the fan-out concern behind the original sketch is answered a different way: the
continuously polled path now touches one dependency instead of two. `/health/live` is still worth having —
it is the only endpoint that distinguishes "the process is dead" from "a dependency is down" — but it is a
diagnostic, not the deploy gate.

### D42 — `GET /health` does not change at all

The full report keeps its path, body, status rule and `no-store` header. It is what the uptime monitor
polls, what the README documents, what `health.e2e-spec.ts` asserts, and the only place a human sees Redis
reported. Its traffic after this change is the monitor's ~8,600 calls a month, which is what a `PING` is
worth paying for.

## Risks / Trade-offs

- **The `healthCheckPath` switch is a deploy-time cutover** → the old path keeps working throughout, and the
  new one ships in the same commit that points the blueprint at it, so the platform never polls a route that
  does not exist. Worst case the blueprint change is missed and Render keeps polling `/health`: the bill
  continues, nothing breaks.
- **Readiness stops reporting Redis, and someone reads that as Redis being unmonitored** → `/health` still
  reports it, the uptime monitor still polls `/health`, and the cache has its own metrics
  (`search_cache_events_total`) and its fail-over counter. The reason is written where the filter is.
- **A future dependency is added as non-critical and its outage becomes invisible to the platform** → that
  is the intended semantics of non-critical, and it is now stated as a requirement rather than left implicit
  in a boolean.
- **Elasticsearch is still polled ~20,000 times a day** → unchanged by this design and explicitly not
  assumed safe; a task measures it against the Elastic Cloud console before this change is called done.
- **`/health/live` has no consumer on day one** → accepted as a small, honest diagnostic rather than a
  speculative feature; it is a controller method with no dependencies and no branching.

## Migration Plan

1. Add both endpoints. `/health` is untouched, so the deploy is a pure addition and independently verifiable.
2. Point `render.yaml` `healthCheckPath` at `/health/ready` in the same change, so the cost drops on the
   deploy that introduces it.
3. After the deploy, confirm against the running service that the polled path is the new one and that
   `/health/ready` answers 200 without credentials — a 401 or 404 here fails deploys, so it is verified
   directly rather than inferred from a green build.
4. Measure the Redis command rate afterwards and record it against the ~605k/month projection.

**Rollback** is a blueprint edit with no code consequence: point `healthCheckPath` back at `/health` and
redeploy. The endpoints themselves are additive and harmless if unused.

## Open Questions

- **What does `indices.exists` cost on Elastic Cloud Serverless at ~20,000 calls a day?** Unmeasured. If it
  turns out to register meaningfully, the options are the memo rejected in D39 (now cheaper to justify, since
  it would apply to one probe on one path) or a longer-lived cached index check. Not decided in advance.
- **Should the uptime monitor move to `/health/ready`?** Keeping it on `/health` is deliberate for now: it is
  the endpoint that would tell a human Redis is down. Revisit if the monitor's own volume ever matters, which
  at 5-minute polls it does not.
