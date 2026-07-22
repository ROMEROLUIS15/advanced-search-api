# Tasks — advanced-search-system

> Ordering reflects the brief's priority: **a functional, well-documented vertical slice first.**
> Groups 1–6 deliver an end-to-end `GET /search` (ranked hits over a real seeded index). Groups 7–12
> layer facets, autocomplete, suggestions, caching, and health onto that slice. Groups 13–16 cover
> cross-cutting concerns, tests, containerization, and the online deploy + docs. Each `[ ]` is a
> verifiable unit. References: `design.md` decisions (D1–D12), `specs/<capability>/spec.md`.

## 1. Project scaffold & tooling

- [x] 1.1 Initialize NestJS + TypeScript project; configure `tsconfig` with strict mode and path aliases per hexagonal layer (`@domain`, `@application`, `@infrastructure`, `@presentation`).
- [x] 1.2 Set up ESLint + Prettier (with `@typescript-eslint/no-explicit-any` as **error** and a max-file-length guard ≈250 lines), Jest (unit, co-located `*.spec.ts`) and Supertest (e2e under `test/`) config, and npm scripts (`start`, `start:dev`, `build`, `test`, `test:e2e`, `lint`, `seed`).
- [x] 1.3 Create the layered folder structure and a root `SearchModule`/`AppModule` wiring skeleton with no logic yet.
- [x] 1.4 Add dependencies: `@nestjs/*`, `@elastic/elasticsearch`, `ioredis`, `class-validator`, `class-transformer`, `zod` + `@nestjs/config`, `helmet`, `@nestjs/terminus`.

## 2. Configuration (D12)

- [x] 2.1 Add `ConfigModule` with a validated (Zod, via a custom `validate` fn) env schema covering Elasticsearch, Redis, cache TTLs, pagination limits, and relevance weights; fail-fast on missing/invalid vars at boot.
- [x] 2.2 Provide a typed config accessor (namespaced config objects) so adapters read config, not `process.env` directly.
- [x] 2.3 Commit `.env.example` documenting every variable with local and cloud (TLS/API-key) example values.

## 3. Domain & application contracts (D9, D10)

- [x] 3.1 Model the `Product` domain entity + `Money` value object with invariants (non-empty name, `price >= 0`, `popularity >= 0`); pure, framework-free.
- [x] 3.2 Define application input/result models: `SearchCriteria`, `SearchOutcome`, `ProductSummary`, `Facets`, `FacetBucket`, `PriceRangeBucket`, `QuerySuggestion`, `AutocompleteItem`.
- [x] 3.3 Declare ports as interfaces + `Symbol` tokens: `ProductSearchPort`, `AutocompletePort`, `QuerySuggestionPort`, `ProductIndexPort`, `CachePort`, health probe port(s).

## 4. Elasticsearch foundation — client, index, mapping (D1, D2)  [spec: product-indexing]

- [x] 4.1 Build an Elasticsearch client factory that selects auth (API key vs. basic) and TLS from env, so the same adapter runs locally and against Elastic Cloud.
- [x] 4.2 Implement `ProductIndexAdapter.ensureIndex()` (idempotent): create versioned index `products_v1` with the D2 mapping + analyzers and the `products` alias if absent.
- [x] 4.3 Implement `bulkIndex()`, `refresh()`, and `count()`; upsert by document `id`; surface per-document failures.
- [x] 4.4 Unit-test the mapping/analyzer definition and `ensureIndex` idempotency (mocked client).

## 5. Seed dataset & command (D2)  [spec: product-indexing]

- [x] 5.1 Author a realistic, varied product dataset (multiple categories/subcategories/locations, price spread, popularity + createdAt distribution) as a versioned JSON fixture.
- [x] 5.2 Implement the `seed` CLI (Nest standalone application context) that calls `ensureIndex()` then `bulkIndex()` + `refresh()`, idempotent on re-run, reporting invalid documents.
- [x] 5.3 Verify `npm run seed` populates a local Elasticsearch and documents are searchable.

## 6. Core search vertical slice (D3, D5, D11)  [spec: product-search]

- [x] 6.1 Implement `SearchQueryBuilder`: `multi_match` (field boosts, `fuzziness: AUTO`, `minimum_should_match`) wrapped in `function_score` (popularity `field_value_factor` + recency `gauss`); `match_all` in browse mode.
- [x] 6.2 Add filter context for category / subcategory (any-of) / location / price range, and the sort strategies (relevance/popularity/created_at) with a stable tiebreaker.
- [x] 6.3 Implement `ElasticsearchProductSearchAdapter.search()` mapping ES hits → `SearchOutcome` (items + total), guarding `from+size` against the max result window.
- [x] 6.4 Implement `SearchProductsUseCase` (no cache yet) depending only on `ProductSearchPort`.
- [x] 6.5 Build `SearchQueryDto` (class-validator input) + `SearchController` `GET /search`; wire the global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`; map domain results to an explicit **response DTO** (`{ data, meta }` envelope) via a dedicated mapper — never serialize the entity directly.
- [x] 6.6 **Milestone:** end-to-end `GET /search?q=...` returns relevance-ranked hits with pagination metadata against the seeded index (unit tests for the query builder + a happy-path e2e).

## 7. Faceting (D4)  [spec: search-faceting]

- [x] 7.1 Extend `SearchQueryBuilder` to move facet filters into `post_filter` and add per-facet `filter` sub-aggregations that exclude their own dimension (terms for category/subcategory/location, range for price).
- [x] 7.2 Map aggregation results into the `facets` block of the response.
- [x] 7.3 Table-driven unit tests for the "exclude own dimension" recipe across every filter combination (the highest-risk logic).

## 8. Sorting, pagination & edge cases (D5)  [spec: product-search]

- [x] 8.1 Enforce configurable default/max `pageSize` (400 on exceed) and reject `from+size` beyond the window (422); compute `totalPages`.
- [x] 8.2 Verify stable ordering across pages for equal sort values (e2e over seeded data).

## 9. Redis caching (D8)  [spec: product-search, autocomplete]

- [x] 9.1 Implement `RedisCacheAdapter` (`CachePort`) with an ioredis client honoring `rediss://`/TLS; namespaced keys including an index-version token.
- [x] 9.2 Wrap `SearchProductsUseCase` with cache-aside (normalized-params key, `CACHE_TTL_SEARCH`); make it fail-open on any Redis error.
- [x] 9.3 Unit-test cache hit/miss and fail-open behavior with a mocked `CachePort`.

## 10. Autocomplete (D6)  [spec: autocomplete]

- [x] 10.1 Implement `ElasticsearchAutocompleteAdapter` querying `name.suggest` (`search_as_you_type`, `bool_prefix`), returning distinct completions honoring `limit`.
- [x] 10.2 Implement `AutocompleteUseCase` with cache-aside (`ac:*`, `CACHE_TTL_AUTOCOMPLETE`, fail-open).
- [x] 10.3 Add `AutocompleteQueryDto` (non-empty `q`, bounded `limit`) + `AutocompleteController` `GET /autocomplete`.

## 11. Query suggestions — "did you mean" & related (D7)  [spec: query-suggestions]

- [x] 11.1 Implement `ElasticsearchQuerySuggestionAdapter` using term + phrase suggesters over `suggest_text`/`.trigram`, with a `collate` query so suggestions return results.
- [x] 11.2 Implement `SuggestQueriesUseCase` + `SuggestionController` `GET /suggest`.
- [x] 11.3 Populate the `suggestions` block of `/search` only on low recall (zero/few hits) within the single ES round-trip.

## 12. Health & readiness (D11)  [spec: service-health]

- [x] 12.1 Implement Terminus indicators (or health probe ports) for Elasticsearch (critical → 503) and Redis (non-critical → reported, still 200).
- [x] 12.2 Add `HealthController` `GET /health` returning the typed status body.

## 13. Cross-cutting: errors, logging, response shape (D10)

- [x] 13.1 Define a domain error hierarchy and a global `AllExceptionsFilter` mapping domain→400/404/422, ES/Redis upstream failures→502/503, validation→400, into `{ statusCode, error, message, details?, timestamp, path }`.
- [x] 13.2 Add request logging + a global response/serialization convention; ensure no unhandled 500s leak stack traces.
- [x] 13.3 Harden the HTTP edge (D13): **Helmet** (CSP disabled for a JSON API) and **environment-aware CORS** driven by `CORS_ORIGINS`; no hard-coded `*` in production.

## 14. Testing

- [x] 14.1 Unit tests for use-cases with mocked ports (search cache-aside, autocomplete, suggestions, health).
- [x] 14.2 Unit tests for `SearchQueryBuilder` (relevance, filters, sort tiebreaker, facet exclusion).
- [x] 14.3 Integration test for the Elasticsearch adapter against a real ES (docker-compose or testcontainers): index → search → facets → suggest.
- [x] 14.4 e2e tests for `/search`, `/autocomplete`, `/suggest`, `/health` covering happy paths and key edge cases (validation 400, window 422, engine-down 503, cache fail-open).

## 15. Containerization (D12)

- [x] 15.1 Multi-stage `Dockerfile` (build → slim runtime, non-root user, healthcheck) producing a small production image.
- [x] 15.2 `docker-compose.yml` wiring API + Elasticsearch + Redis with healthchecks, volumes, and env wiring; a one-shot seed service/profile.
- [x] 15.3 Verify `docker compose up` yields a healthy stack and a working `GET /search` locally.

## 16. Online deploy & documentation (D12, Migration Plan)

- [ ] 16.1 Provision managed Elasticsearch (Elastic Cloud/Bonsai) + managed Redis (Upstash); configure env vars on the container host (Render/Railway) with TLS + API keys.
- [ ] 16.2 Deploy the image; run the one-off seed job against the managed cluster; confirm `/health` green and `/search` returning hits online.
- [ ] 16.3 Write the `README` (architecture overview, local + Docker run, testing, env reference, deploy steps, live URL) and record decisions traceable to `design.md`.
- [ ] 16.4 Build the Postman collection with preconfigured requests for all endpoints (env-parameterized base URL) and example queries.
