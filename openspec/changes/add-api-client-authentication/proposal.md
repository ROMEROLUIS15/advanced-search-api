## Why

The service is deployed and **anyone on the internet can call it**. Measured against production today: `/`,
`/search`, `/autocomplete`, `/suggest`, `/docs` and `/docs-json` all answer `200` to an anonymous request. The
only control in front of them is a per-IP rate limit, which paces a stranger rather than stopping one.

That was acceptable while this was a technical exercise. It is not what the project needs: the API is consumed
by the project's owners, and the catalogue it serves — every product, with prices, paginated and filterable —
is not meant to be readable, or scrapable, by whoever finds the URL. The published OpenAPI contract makes that
easier, not harder.

## What Changes

- **BREAKING**: every endpoint except `GET /health` requires an `X-API-Key` header. Without a valid key the
  response is `401` in the standard error envelope. This includes `/`, `/docs` and `/docs-json`: the contract
  is not public either.
- Keys are configured as a list, so several consumers can hold different keys and a key can be rotated by
  adding the new one before removing the old.
- **Secure by default**: authentication is on unless explicitly switched off, and a deployment that enables it
  without configuring any key **fails to start** rather than coming up open. Local development and CI opt out
  on purpose and say so.
- `GET /health` stays reachable without a key — the platform's readiness probe cannot send headers, and a probe
  that 401s would take the service down. `GET /metrics` keeps its own bearer token (design D23) rather than
  joining the API-key scheme.
- Keys are compared in constant time, and never logged: the correlation id already identifies a request, and a
  key is a credential.
- The rate limiter now counts **per consumer** instead of per IP where a key is present. Several owners behind
  one office address stop sharing a bucket, and a leaked key can be throttled or revoked on its own.

## Capabilities

### New Capabilities

- `api-client-authentication`: who may call this API at all — key verification, the paths that stay open, and
  the fail-fast posture that keeps a misconfigured deployment from being silently public.

### Modified Capabilities

- `request-rate-limiting`: the client identity a budget is counted against becomes the API key when the caller
  presents one, falling back to the address only where no key is required.
- `service-health`: the readiness endpoint must remain reachable without credentials, which is now a property
  worth stating rather than an accident of there being no auth.

## Impact

- **No new dependencies.** Key comparison uses `node:crypto`; the guard is the same `APP_GUARD` mechanism the
  rate limiter already uses.
- **New configuration**: `API_AUTH_ENABLED` and `API_KEYS`, validated in `env.schema.ts` with a cross-field
  rule, and declared in `render.yaml` so a fresh blueprint prompts for them.
- **CI**: the e2e and integration jobs run with authentication disabled, as they exercise domain behaviour; a
  dedicated e2e suite turns it on and asserts the edge. The DAST job also disables it, for the same reason it
  disables rate limiting — ZAP is there to fuzz the application surface, and a wall of 401s would hide it.
- **Consumers**: the owners need their key. Existing callers break until they send it, which is the point.
