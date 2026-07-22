## Why

Manufacturer and product discovery in "Factory" only works if users can find the right
products fast — even from vague, partial, or misspelled input. A plain relational `LIKE`
query cannot rank by relevance, tolerate typos, suggest alternatives, or return the faceted
navigation a discovery experience needs. This change introduces a dedicated search service,
built on Elasticsearch behind a clean hexagonal NestJS API, that delivers relevance-ranked
results, faceted filtering, type-ahead autocomplete, and query suggestions.

## What Changes

- New standalone **search API** (NestJS, strict hexagonal architecture). No frontend; the only
  persistence it owns is the Elasticsearch index it reads from.
- **Full-text search** over name / description / category / subcategories / location, ranked with
  BM25 and a `function_score` that boosts by popularity and recency.
- **Filtering** by category, subcategory, location, and price range — usable combined or individually.
- **Faceting**: aggregation counts for category, subcategory, location, and price ranges returned
  alongside results, with correct combined-filter semantics (a facet's own dimension is not
  narrowed by its own selection).
- **Pagination** and **multi-key sorting** (relevance, popularity, created_at) with a stable order.
- **Autocomplete / type-ahead** endpoint backed by an Elasticsearch suggester and a Redis prefix cache.
- **"Did you mean" + related queries** via Elasticsearch term & phrase suggesters, surfaced when a
  search returns few or no hits.
- **Elasticsearch index** with an explicit mapping/analyzer strategy, plus a **seed script** that
  bulk-indexes a realistic, varied dataset.
- **Redis caching** for hot search results and autocomplete prefixes.
- **Health / readiness** endpoint reporting Elasticsearch and Redis connectivity for container probes.
- **Delivery**: multi-stage Dockerfile + docker-compose (API + Elasticsearch + Redis), environment-based
  config designed for managed cloud targets (TLS + API keys), a clear README, and a preconfigured
  Postman collection.

Priority (per the brief — *"a functional, well-documented delivery matters more than completeness"*):
a working vertical slice of `product-search` comes first; faceting, autocomplete, and suggestions
build on top of it.

## Capabilities

### New Capabilities
- `product-search`: full-text query + filters (category, subcategory, location, price range) +
  relevance ranking (BM25 + `function_score`) + pagination + multi-key sorting + hot-result caching.
- `search-faceting`: facet aggregations (category, subcategory, location, price ranges) returned with
  results, honoring combined and individual filter semantics.
- `autocomplete`: type-ahead endpoint backed by an Elasticsearch suggester with a Redis prefix cache.
- `query-suggestions`: "did you mean" and related/alternative query suggestions via term & phrase
  suggesters, surfaced on low-recall searches.
- `product-indexing`: Elasticsearch index mapping/analyzers and idempotent bulk seed ingestion of a
  realistic dataset.
- `service-health`: health/readiness endpoint reporting Elasticsearch and Redis connectivity for
  container-host probes.

### Modified Capabilities
- _None._ Greenfield project — no existing specs in `openspec/specs/`.

## Impact

- **New NestJS scaffold** organized by hexagonal layers: `domain` / `application` (use-cases + ports) /
  `infrastructure` (Elasticsearch + Redis adapters) / `presentation` (HTTP controllers + DTOs).
- **New dependencies**: `@nestjs/*`, `@elastic/elasticsearch`, `ioredis`, `class-validator`,
  `class-transformer`, plus dev/test tooling (`jest`, `supertest`).
- **New infrastructure**: Elasticsearch and Redis (local via docker-compose; managed services in cloud).
- **New endpoints**: `GET /search`, `GET /autocomplete`, `GET /suggest`, `GET /health`.
- **New deliverables**: Dockerfile, docker-compose, `.env` schema, README, Postman collection, seed script.
- **Config surface**: env vars for Elasticsearch URL / API key / TLS, Redis URL / TLS, cache TTLs,
  relevance boost weights, and pagination limits — all environment-driven for local vs. cloud.
