## 1. Readiness in the application layer (design D39)

- [ ] 1.1 `CheckHealthUseCase` gains a way to evaluate a subset of probes selected by `critical`, without
      duplicating the aggregation, the transition logging or the `Promise.allSettled` handling
- [ ] 1.2 Specs: readiness over a critical + non-critical probe pair calls **only** the critical one (assert
      the non-critical probe's `ping` was never invoked — that is the whole point of the change); readiness
      is 503 when the critical probe is down; readiness is 200 when only the non-critical one is down
- [ ] 1.3 Specs: the existing full report is unaffected — still calls every probe and still applies the
      non-critical rule

## 2. The two endpoints (design D40, D41)

- [ ] 2.1 `GET /health/ready` on `HealthController`: critical probes only, 200/503 by the same rule as
      `/health`, `no-store`, and the same response DTO shape
- [ ] 2.2 `GET /health/live`: 200 with no dependency call at all
- [ ] 2.3 Both documented in OpenAPI with their statuses, consistent with how `/health` is declared
- [ ] 2.4 Controller specs for both, including that liveness answers 200 with every probe failing

## 3. Exemptions verified, not assumed (design D40)

- [ ] 3.1 Extend the `operator-paths` spec table with `/health/ready` and `/health/live` as matching, and a
      near-miss that must not match, so the sub-path rule the whole design rests on is pinned by a test
- [ ] 3.2 e2e: both endpoints answer without an API key while authentication is enabled (a 401 on the polled
      path would fail every deploy)
- [ ] 3.3 e2e: neither endpoint is counted by the rate limiter, and `/health` keeps its own exemption

## 4. Deployment (design D41)

- [ ] 4.1 `render.yaml` `healthCheckPath` → `/health/ready`, with the reason in a comment beside it
- [ ] 4.2 Confirm the blueprint still parses and the rest of the service definition is untouched

## 5. Documentation

- [ ] 5.1 README: the endpoint table and the `/health` section gain the two new endpoints, and state which
      one Render polls and why readiness excludes Redis
- [ ] 5.2 `CLAUDE.md`: the health bullet covers the three endpoints and the "readiness only probes what can
      change the answer" rule
- [ ] 5.3 `docs/PENDING-2026-07-28.md`: H2 and B4 reflect what this change closed and what it deliberately
      did not

## 6. Verify against the running service

- [ ] 6.1 Full gate green: `lint:ci`, `test:cov`, `build`, plus integration and e2e against the local stack
- [ ] 6.2 After deploy: `GET /health/ready` and `GET /health/live` answer 200 without credentials in
      production, and `/health` still reports both dependencies
- [ ] 6.3 Confirm Render is polling the new path — the `route="/health/ready"` series climbs at the platform
      rate while `route="/health"` drops to the monitor's cadence
- [ ] 6.4 Record the resulting Redis command rate against the ~605k/month projection, in
      `docs/OBSERVABILITY-2026-07-27.md` alongside the other measured numbers
- [ ] 6.5 Measure what ~20k/day of `indices.exists` costs on the Elastic Cloud console and record it; if it
      registers meaningfully, open a follow-up rather than improvising a fix here (design "Open Questions")
