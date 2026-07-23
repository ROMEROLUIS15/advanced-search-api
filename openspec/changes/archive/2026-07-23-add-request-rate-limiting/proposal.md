## Why

Every endpoint is a public, unauthenticated `GET` that fans out to metered infrastructure — Elastic Cloud
Serverless bills by usage and Upstash caps daily commands — and nothing limits how fast a client may call
them. The 2026-07-23 audit raised this as finding F3, and the load test made it concrete: a single laptop
sustained **1,593 req/s** against the service with no back-pressure of any kind. The existing guards constrain
the *shape* of a request (`pageSize` above the maximum ⇒ 400, `from+size` beyond the result window ⇒ 422) but
never its *rate*.

## What Changes

- Add per-client, per-endpoint request rate limiting to the public read endpoints, enforced at the HTTP edge.
- Count requests in **Redis** so the limit is shared across instances, falling back to an **in-memory,
  per-process counter** whenever Redis is unavailable. The limiter never fails open (no protection) and never
  fails closed (service outage): Redis remains a non-critical dependency, as design D8 and the `/health`
  contract already require.
- Exceeding a limit returns **429 Too Many Requests** in the project's standard typed error body, mapped
  centrally in `AllExceptionsFilter` like every other status.
- Answer with `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset` headers so a client can
  self-regulate before being rejected, plus `Retry-After` on a 429.
- Limits are per endpoint and environment-tunable, defaulting to **60/min** for `GET /search` and
  `GET /suggest`, **300/min** for `GET /autocomplete` (a type-ahead box fires on nearly every keystroke), and
  a shared default for `GET /`.
- **`GET /health` is exempt.** Render polls it as the service's `healthCheckPath`; throttling it could fail a
  deploy or flap the instance.
- Trust the platform proxy so the client identity comes from `X-Forwarded-For`. Without this, every request
  behind Render's proxy presents the same source address, all users share one bucket, and a single abusive
  client locks out everyone else.
- Not a breaking change: no existing successful response changes shape, and the default limits sit far above
  any legitimate interactive use.

## Capabilities

### New Capabilities

- `request-rate-limiting`: how many requests a single client may make to each public endpoint per time
  window, what happens when that is exceeded, which endpoints are exempt, how a client is identified behind a
  proxy, and how the limiter behaves when its shared counter store is unreachable.

### Modified Capabilities

None. Rate limiting is a cross-cutting edge concern with its own capability: what a search, an autocomplete or
a suggestion *returns* is unchanged, so `product-search`, `autocomplete`, `query-suggestions`,
`search-faceting`, `product-indexing` and `service-health` keep their requirements as they stand. The 429 and
the exemption of `/health` are stated as requirements of the new capability rather than smeared across the
six existing ones.

## Impact

- **Dependencies**: adds `@nestjs/throttler` (official Nest package). No third-party storage package — the
  Redis-plus-fallback store is implemented in this repo against the existing Redis client.
- **Application layer**: a new port + `Symbol` token for the counter store, keeping `ioredis` out of the
  use-case and domain layers as the architecture requires.
- **Infrastructure layer**: a Redis adapter for that port and an in-memory adapter used as the fallback.
- **Presentation layer**: the guard, the 429 mapping in `AllExceptionsFilter`, and the response headers.
- **Composition**: a new module registering the guard globally, wired from `app.module.ts`.
- **Configuration**: new environment variables validated by `env.schema.ts` and exposed through `APP_CONFIG`,
  fail-fast like the rest.
- **Edge pipeline**: `app.setup.ts` gains the proxy-trust setting, so `main.ts` and every e2e test keep
  exercising an identical edge.
- **Docs**: `README.md` (endpoint contract, error table, env table) and the Postman collection gain the 429
  case; the audit's finding F3 is closed.
- **Tests**: unit specs for the store adapters and the guard, plus an e2e case that exhausts a limit and
  asserts the 429 body and headers.
