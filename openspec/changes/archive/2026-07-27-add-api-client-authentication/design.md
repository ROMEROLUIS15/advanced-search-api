## Context

The deployment is reachable by anyone. Measured before writing this: `/`, `/search`, `/autocomplete`,
`/suggest`, `/docs` and `/docs-json` all return `200` to an anonymous caller, and the per-IP rate limit is the
only thing in front of them — it paces a stranger, it does not stop one, and rotating addresses defeats it.

The consumers are the project's owners: server-side callers, few, known. That shapes everything below. There is
no end-user login to build here and no third-party developer ecosystem to onboard; there is a small set of
machine clients that must be told apart from everyone else.

Constraints carried over: hexagonal layering, DI by `Symbol` token, no `process.env` outside `config/`,
`max-lines: 250`, explicit return types, no `any`. The rate limiter already registers a global guard through
`APP_GUARD`, and `AllExceptionsFilter` already owns every error body.

## Goals / Non-Goals

**Goals:**

- Nobody without a key can read the catalogue, or the contract that describes it.
- A deployment cannot be silently public through misconfiguration.
- Keys can be rotated and revoked per consumer without downtime.
- The platform's readiness probe keeps working, unchanged.

**Non-Goals:**

- End-user authentication, sessions, roles or a login flow. Different problem, different sprint.
- An authorization model: every key that is valid may do everything. The API is read-only and every consumer
  is an owner; per-key scopes would be machinery with no decision behind it.
- Key issuance tooling, a self-service portal, or storing keys in a database. A handful of keys in the
  deployment's environment is the right weight for a handful of known consumers.
- Encrypting or hashing keys at rest in the environment: whoever can read the service's environment already
  controls the service.

## Decisions

### D30 — A shared secret in `X-API-Key`, not OAuth or JWT

The consumers are machines the owners control. A shared secret they send on every call is the lightest thing
that authenticates them, needs no issuer, no clock skew handling and no refresh dance.

*Rejected:* OAuth 2.0 client credentials — correct for a third-party ecosystem, but it means running or renting
an authorization server to serve a handful of internal callers. *Rejected:* signed JWTs — they buy stateless
expiry and claims, neither of which is needed when the caller list is short and revocation means editing an
environment variable.

`X-API-Key` rather than `Authorization: Bearer` because `/metrics` already uses a bearer for a *different*
credential (design D23), and one header carrying two unrelated secrets depending on the path is a trap.

### D31 — On by default; enabled without keys is a startup failure

The dangerous failure is not a rejected request, it is a deployment that comes up open because a variable was
missed. So `API_AUTH_ENABLED` defaults to **true**, and a zod cross-field rule makes an empty `API_KEYS` fatal
when it is on. A service that cannot authenticate anyone refuses to start rather than serving everyone.

Disabling it is therefore always deliberate and always visible: `.env.example`, the CI jobs and the DAST job
each say `API_AUTH_ENABLED=false` in plain sight, with the reason next to it.

*Rejected:* inferring the mode from whether keys are present — the same shape used for the OTLP exporter, which
is right for an optional feature and wrong for a gate, because a typo in the variable name would open the API
silently.

### D32 — The operator endpoints are outside the scheme; `/docs` is not

`/health` must answer without credentials: Render's readiness probe cannot send headers, and a 401 there is
read as an unhealthy instance, so requiring a key would take the service down.

`/metrics` is exempt from the **API-key** guard for a different reason: it already carries its own bearer token
(D23), and stacking a second credential on it would mean a monitoring agent needs an application key it has no
other use for. So the exemption list is exactly the operator paths already shared by the request log and the
tracer — `shared/operator-paths.ts` — and neither of them is thereby open: one is a public probe by design, the
other is protected by its own secret.

`/docs` and `/docs-json` are **not** exempt. The contract describes every parameter of a catalogue that is not
meant to be read by strangers; publishing it while gating the data is a lock on the door with the blueprints
taped to the window.

`/metrics` keeps its own bearer token (D23) instead of joining this scheme. Two different audiences — a
monitoring agent and an application client — with two different credentials that can be rotated on their own
schedules.

### D33 — Constant-time comparison over fixed-length digests

Keys are compared with `timingSafeEqual`, which needs equal-length buffers, so both sides are SHA-256 digests
of the key rather than the raw strings. That also removes any length signal. Digests are computed once at
startup, not per request.

A rejection says only that a valid key is required. It does not say whether the key was absent, malformed or
merely unknown, and the presented value is never logged — the correlation id already identifies the request for
support purposes.

### D34 — The rate limiter counts per consumer once there is a consumer

With callers identified, `req.ip` is the wrong bucket: several owners behind one office address would share a
budget, and a leaked key could not be throttled without throttling the address. `RateLimitGuard.getTracker`
now returns a **short digest of the API key** when the request carries a valid one, and the address otherwise.

The digest matters twice: a credential must not be written into Redis where it would outlive the request, and
the tracker string ends up in a key that an operator may read while debugging.

## Risks / Trade-offs

- **Existing callers break the moment this deploys.** That is the intent, but it is still an outage for anyone
  already integrated → the owners get the key before the deploy, and the change is announced in the README's
  API section rather than only in a commit message.
- **A key in an environment variable is a long-lived secret** with no expiry → rotation is supported by design
  (several keys valid at once), and the variable is `sync: false` in the blueprint so it never lands in the
  repo.
- **`/health` remains an unauthenticated endpoint** and reports dependency status → it discloses whether
  Elasticsearch and Redis are reachable, which is a small, deliberate leak in exchange for a working probe. It
  exposes no data and no configuration.
- **DAST scans with authentication off** → the same reasoning that already disables rate limiting for that job:
  ZAP is there to fuzz the application's surface, and a wall of 401s would hide it. The gate itself is covered
  by the e2e suite instead.
- **Timing comparison protects the key, not the endpoint** → an attacker can still brute-force blindly; the
  rate limiter is what makes that expensive, and it now counts unauthenticated attempts against the address.

## Migration Plan

1. Ship with `API_AUTH_ENABLED=false` nowhere set in production yet — the code deploys, still open.
2. Generate a key, set `API_KEYS` on the service, and give it to the owners.
3. Let the default take effect (authentication on) and verify: `/health` 200 without a key, `/search` 401
   without and 200 with.

Rollback is setting `API_AUTH_ENABLED=false`, which takes a redeploy of configuration and no code change.

## Open Questions

- **How many keys, and who holds which?** One per consumer is better than one shared secret — it makes
  revocation surgical. The list supports it; the owners decide how many they want.
