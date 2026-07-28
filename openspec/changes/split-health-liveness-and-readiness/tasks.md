## 1. Readiness in the application layer (design D39)

- [x] 1.1 `CheckHealthUseCase` gains a way to evaluate a subset of probes selected by `critical`, without
      duplicating the aggregation, the transition logging or the `Promise.allSettled` handling
- [x] 1.2 Specs: readiness over a critical + non-critical probe pair calls **only** the critical one (assert
      the non-critical probe's `ping` was never invoked — that is the whole point of the change); readiness
      is 503 when the critical probe is down; readiness is 200 when only the non-critical one is down
- [x] 1.3 Specs: the existing full report is unaffected — still calls every probe and still applies the
      non-critical rule

## 2. The two endpoints (design D40, D41)

- [x] 2.1 `GET /health/ready` on `HealthController`: critical probes only, 200/503 by the same rule as
      `/health`, `no-store`, and the same response DTO shape
- [x] 2.2 `GET /health/live`: 200 with no dependency call at all
- [x] 2.3 Both documented in OpenAPI with their statuses, consistent with how `/health` is declared
- [x] 2.4 Controller specs for both, including that liveness answers 200 with every probe failing

## 3. Exemptions verified, not assumed (design D40)

- [x] 3.1 Extend the `operator-paths` spec table with `/health/ready` and `/health/live` as matching, and a
      near-miss that must not match, so the sub-path rule the whole design rests on is pinned by a test
- [x] 3.2 e2e: both endpoints answer without an API key while authentication is enabled (a 401 on the polled
      path would fail every deploy)
- [x] 3.3 e2e: neither endpoint is counted by the rate limiter, and `/health` keeps its own exemption

## 4. Deployment (design D41)

- [x] 4.1 `render.yaml` `healthCheckPath` → `/health/ready`, with the reason in a comment beside it
- [x] 4.2 Confirm the blueprint still parses and the rest of the service definition is untouched

## 5. Documentation

- [x] 5.1 README: the endpoint table and the `/health` section gain the two new endpoints, and state which
      one Render polls and why readiness excludes Redis
- [x] 5.2 `CLAUDE.md`: the health bullet covers the three endpoints and the "readiness only probes what can
      change the answer" rule
- [x] 5.3 `docs/PENDING-2026-07-28.md`: H2 and B4 reflect what this change closed and what it deliberately
      did not

## 6. Verify against the running service

- [x] 6.1 Full gate green: `lint:ci`, `test:cov`, `build`, plus integration and e2e against the local stack
- [x] 6.2 Verified in production 2026-07-28: `/health/ready` answers 200 with Elasticsearch only,
      `/health/live` 200 with an empty `info`, `/health` 200 with both dependencies — all three with no
      credential, which is what keeps deploys passing
- [x] 6.3 Confirmed: `increase(...[5m])` reads **71.25** on `route="/health/ready"` (one every 4.2 s, the
      platform cadence) against **0** on `route="/health"`. Measured as a rate over a window starting after
      the deploy, because the totals during the overlap read backwards — see the trap recorded in
      `docs/OBSERVABILITY-2026-07-27.md`
- [x] 6.4 Recorded: health-driven Redis traffic falls from ~605k commands/month to the monitor's ~8.6k, a
      70× reduction, since readiness issues no Redis call at all
- [ ] 6.5 Measure what ~20k/day of `indices.exists` costs on the Elastic Cloud console and record it; if it
      registers meaningfully, open a follow-up rather than improvising a fix here (design "Open Questions")
