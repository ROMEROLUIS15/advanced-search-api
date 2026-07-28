## Why

Render polls `healthCheckPath` every **~4.3 s** (measured 2026-07-28:
`increase(http_requests_total{route="/health"}[5m])` = 70.0 in steady state, well clear of any deploy
window), and the blueprint exposes no way to slow it down. Every one of those polls runs both probes in
parallel — one Redis `PING` and one Elasticsearch `indices.exists` — so the service spends **~605,000 Upstash
commands a month against a 500,000 free-tier allowance**: a breach in roughly 25 days, before any real cache
traffic is counted.

This only became true on 2026-07-28. Until then the GitHub keep-alive cron was delivering about one run an
hour instead of the scheduled six, so the instance slept most of the day and the platform's polling barely
ran. Fixing the keep-alive is what started the clock, and it also revises an earlier withdrawn finding: the
poll rate had been estimated correctly all along, it was the duty cycle that was wrong.

Half of that spend can never change an answer. Redis is non-critical by design — its outage is reported but
never alters the status code — so polling it 20,000 times a day tells the platform nothing it acts on.

## What Changes

- **Add `GET /health/ready`** — the readiness endpoint the platform polls. It runs the **critical** probes
  only, which today means Elasticsearch plus the existence of the configured index. This preserves the deploy
  gate: a deployment against an unseeded cluster still never turns healthy, so Render fails the deploy rather
  than routing traffic to a service that cannot answer.
- **Add `GET /health/live`** — liveness with no dependency calls at all: it answers 200 whenever the process
  is running.
- **`GET /health` is unchanged** — the full report over every probe, critical and not, for humans and for the
  external uptime monitor. Its body, its status-code rule and its `no-store` header all stay as they are.
- **Point `render.yaml` `healthCheckPath` at `/health/ready`**, which takes health-driven Redis traffic to
  zero and leaves the monitor's 5-minute polls (~8,600/month) as the only regular source.
- **Record the index-existence rule in the spec.** Readiness has proven the index since 2026-07-28 but the
  requirement was never written down — a pre-existing drift this change closes rather than leaves behind.

No breaking change: every existing path, body and status code is preserved, and the two new endpoints are
additive.

## Capabilities

### New Capabilities

None. This extends an existing capability rather than introducing one.

### Modified Capabilities

- `service-health`: the single "Health and readiness endpoint" requirement splits into three — the existing
  full report at `/health`, a critical-only readiness endpoint, and a dependency-free liveness endpoint —
  and gains the rule that readiness proves the configured index exists, plus the rule that the endpoint a
  platform polls continuously MUST NOT call dependencies whose state cannot change its answer.

## Impact

- **Code**: `HealthController` gains two routes; `CheckHealthUseCase` gains a way to run a probe subset
  selected by criticality; `HealthModule` unchanged in its wiring.
- **Deployment**: `render.yaml` `healthCheckPath` moves to `/health/ready`. The change only takes effect on
  the deploy that applies it, and the old path keeps working throughout, so there is no window where the
  platform polls a route that does not exist.
- **Exemptions**: none needed. `matchesPath` already matches sub-paths, so `/health/*` inherits all four
  operator-path behaviours — API-key guard bypass, rate-limit exemption, trace-sampler drop and request-log
  skipping — with no change to `operator-paths.ts`. This was verified in the code before proposing, not
  assumed.
- **Docs**: the README endpoint table and `/health` section, and the CLAUDE.md health bullet.
- **Not addressed here**: Elasticsearch is still polled ~20,000 times a day by readiness. That call is
  metadata-only and cheap, but its cost against Elastic Cloud has **not been measured**, and this change does
  not assume it is free. Measuring it is a task in this change; acting on it is not.
