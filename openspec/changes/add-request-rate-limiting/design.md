## Context

The service exposes four public, unauthenticated `GET` endpoints over metered infrastructure and has no
back-pressure: the 2026-07-23 load test drove 1,593 req/s from one machine without being slowed. Two design
decisions already in force constrain how this may be solved:

- **D8** — Redis is used cache-aside and **fail-open**: a Redis error is logged and treated as a miss, never
  as a request failure.
- **Health** — Elasticsearch is critical (down ⇒ 503) while **Redis is explicitly non-critical**: `/health`
  reports its outage and still returns 200.

Any rate limiter that made Redis mandatory would contradict both. The decisions below continue the project's
numbering, which reaches **D13** in the archived `advanced-search-system` change.

## Goals / Non-Goals

**Goals:**

- Bound how fast a single client can drive Elasticsearch and Redis through the public endpoints.
- Keep protection in force even while Redis is unavailable.
- Keep Redis non-critical: no limiter failure mode may take the API down.
- Keep the limits and the whole feature environment-tunable, with no `localhost` or platform assumption.
- Keep the architecture intact: no Redis type crosses a port, no adapter is imported by a use-case.

**Non-Goals:**

- Authentication, API keys or per-account quotas — there is no identity in this service.
- Global//distributed quota accounting beyond a simple per-window counter.
- Protecting against distributed abuse from many addresses (that is a CDN/WAF concern, not an app concern).
- Rate limiting internal calls to Elasticsearch or Redis; this is strictly an HTTP-edge control.

## Decisions

### D14 — Counter in Redis with an in-memory fallback (fail-over, not fail-open)

The shared counter lives in Redis so the limit is one limit across instances. When Redis is unreachable the
limiter **falls over to a per-process in-memory counter** instead of giving up.

*Alternatives considered:*

- **Fail-open (skip the limit when Redis is down)** — rejected. The same Redis backs the search cache, so an
  outage removes the cache *and* the limiter at once: every request would reach Elasticsearch at exactly the
  moment nothing is throttling them. The two failures are correlated in the worst possible direction.
- **Fail-closed (reject when Redis is down)** — rejected. It converts a non-critical dependency into a
  critical one, contradicting D8 and the `/health` contract, and turns "cannot count" into a total outage.
- **In-memory only** — rejected as the primary design, though it is the fallback. With one Render instance it
  is equivalent, but the service must not be designed to assume one instance.

*Consequence:* during a Redis outage with N instances the effective ceiling is N × limit. That is a bounded,
documented loss of precision, and infinitely better than no ceiling at all.

### D15 — `@nestjs/throttler` with a storage adapter written here

Use the official `@nestjs/throttler` guard, implementing its storage contract with our own adapter rather
than pulling a third-party Redis storage package.

*Alternatives considered:* a fully hand-rolled guard (more code to test for semantics that are already
solved); `nestjs-throttler-storage-redis` (a third-party runtime dependency on the request path, for roughly
forty lines of `INCR`/`EXPIRE` we can own and test). Writing the adapter keeps the supply chain at one
official package and lets the fallback behaviour of D14 live in our code, where it can be unit-tested.

### D16 — Identify the client by IP, resolved through a bounded proxy-trust setting

The client identity is the source address, taken from `X-Forwarded-For` when the app runs behind a proxy.
Express is told to trust a **configurable number of proxy hops** (`TRUST_PROXY_HOPS`, default `0`), not
`true`.

*Rationale:* trusting the header unconditionally lets any client forge its own address and walk straight past
the limiter, so blanket `trust proxy: true` would make the whole feature decorative. A hop count means only
the platform's own proxy is believed. Locally the default of `0` trusts nothing, which is correct for a
direct connection; Render sets `1`.

*Consequence:* clients sharing a NAT or corporate egress share a bucket. The limits are set high enough that
interactive use is unaffected.

### D17 — Per-endpoint limits, with `/health` exempt

`GET /autocomplete` is called on nearly every keystroke and cannot share a budget with `GET /search`, which a
user triggers deliberately. Defaults: 60/min for `/search` and `/suggest`, 300/min for `/autocomplete`, 120/min
default for anything else (`GET /`). **`GET /health` is never limited** — Render polls it as the service's
`healthCheckPath`, and throttling it risks failing a deploy or flapping a healthy instance.

### D18 — 429 mapped centrally, with standard headers

The guard throws; `AllExceptionsFilter` maps it to **429** with the same
`{ statusCode, error, message, timestamp, path }` body as every other error, so the contract stays uniform. Every
response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`; a 429 also carries
`Retry-After`. Status codes are not assembled in controllers or adapters, per the existing rule.

### D19 — The feature is switchable at runtime

`RATE_LIMIT_ENABLED` (default `true`) turns enforcement off without a code change. This is the rollback lever
(see Migration Plan) and it is also what the load-test battery uses: the battery deliberately drives far more
traffic than any human, so a capacity measurement runs with enforcement disabled and says so.

## Risks / Trade-offs

- **A Redis outage degrades the limit to per-instance** → bounded and documented (D14); with today's single
  instance the effective limit is unchanged.
- **Redis adds a round-trip to every request** → one pipelined `INCR` + `EXPIRE`; the local load test measured
  Redis-backed reads at ~3 ms p95, and the battery is re-run after implementation to quantify the real cost.
- **A forged `X-Forwarded-For` could impersonate another client's bucket, or dodge its own** → mitigated by
  trusting a fixed hop count rather than the raw header (D16).
- **Shared egress addresses share a bucket** → accepted; limits sized so normal interactive use never
  approaches them.
- **The e2e suite issues many requests quickly from one address and could throttle itself** → the suites run
  with limits configured high enough not to interfere, except the one spec that deliberately exhausts a limit
  and pins its own low value via `overrideProvider(APP_CONFIG)`, the pattern `resilience.e2e-spec.ts` already
  uses.
- **A legitimate burst gets a 429** → the `RateLimit-*` headers let a well-behaved client slow down before it
  happens, and the window is short (a minute), so recovery is quick.

## Migration Plan

1. Ship with `RATE_LIMIT_ENABLED=true` and the default limits; no data migration is involved.
2. Set `TRUST_PROXY_HOPS=1` on Render, where the app sits behind the platform proxy. Leave it `0` locally.
3. Watch for unexpected 429s after deploy; the limits are env variables, so raising them is a config change
   and a restart, not a release.
4. **Rollback:** set `RATE_LIMIT_ENABLED=false`. The guard becomes a pass-through and the previous behaviour
   is restored without reverting code or rebuilding the image.

## Open Questions

None blocking. Two deliberately deferred: whether to add a burst allowance on top of the fixed window (only
worth it if real traffic shows bursty-but-legitimate clients), and whether abuse from many addresses should be
handled at all — that belongs in front of the app, not inside it.
