# API authentication rollout — 2026-07-27

The deployment stopped being open. Before this change, `/`, `/search`, `/autocomplete`, `/suggest`, `/docs` and
`/docs-json` all answered **200** to an anonymous request; the per-IP rate limit was the only thing in front of
them, and it paces a stranger rather than stopping one.

Driven through OpenSpec as `add-api-client-authentication` (design **D30–D34**).

## What changed

Clients present `X-API-Key`. Without a valid key the answer is 401 in the standard error envelope.

| Endpoint | Before | Now |
|---|---|---|
| `/`, `/search`, `/autocomplete`, `/suggest` | 200 to anyone | **401** without a key |
| `/docs`, `/docs-json` | 200 to anyone | **401** without a key |
| `/health` | 200 | 200 — open by design, the platform probe cannot send headers |
| `/metrics` | bearer token | unchanged: its own token, not the API key |

## Two things a guard alone would have got wrong

**Swagger is not a Nest route.** `SwaggerModule` mounts `/docs` and `/docs-json` straight onto Express, so no
`APP_GUARD` ever runs for them. The whole contract would have stayed public while the data behind it was
locked. They are protected by a middleware registered in `swagger.setup.ts` instead — the one place an error
body is built outside `AllExceptionsFilter`, because nothing thrown there would reach the filter.

**Guard order decides who pays for a flood.** Nest runs global guards in registration order. With
authentication first, an unauthenticated flood is rejected without ever touching a budget — free load.
`ApiAuthModule` is therefore imported *after* `RateLimitModule`, so unauthenticated attempts still count
against the caller's address.

## Secure by default

`API_AUTH_ENABLED` defaults to **true**, and enabling it with no key configured is a **startup failure**, not a
warning. A deployment cannot come up open because a variable was missed. Every place that runs without
authentication says so explicitly, with the reason next to it: both CI jobs, the DAST job, `.env.example` and
the spec fixtures.

That posture has a rollout consequence, and it is not theoretical: **the keys must exist on the service before
the code that requires them arrives**. They were set first; had the deploy landed first, the service would have
refused to start and production would have gone down — the failure working exactly as designed, at the worst
possible moment.

## Verified in production

```
/search    without a key -> 401      with a key -> 200
/docs-json without a key -> 401
/health    without a key -> 200
```

Locally before the deploy: 65 suites / 389 unit tests, 9 e2e suites / 44 tests, coverage 98.21 % statements /
92.62 % branches, `lint:ci` clean, build clean.

## Operating notes

- **Two keys are live.** More than one is valid at a time on purpose: rotation is adding the new key to
  `API_KEYS`, moving consumers across, then removing the old one. No downtime, no code change.
- **Rollback** is `API_AUTH_ENABLED=false` on the service — configuration, not a deploy of code.
- **The limiter now counts per consumer**, keyed by a truncated digest of a *valid* key. Two owners behind one
  office address no longer share a budget; a caller guessing keys still counts against its address, so guessing
  cannot mint fresh budgets.
- **Keys never appear** in logs, traces, error bodies or the counter store.

## Deliberately not done

- **Per-key scopes.** Every valid key may do everything. The API is read-only and every consumer is an owner;
  scopes would be machinery with no decision behind them.
- **End-user login.** A different problem — who the *person* is, rather than which machine may call. Planned
  for a later sprint.
- **Key issuance tooling or a database.** A handful of keys in the deployment's environment is the right weight
  for a handful of known consumers.
