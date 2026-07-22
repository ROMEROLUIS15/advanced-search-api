# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state: spec-first, greenfield — no code yet

This repo is an **Advanced Product Search API** technical challenge, planned but **not yet implemented**.
There is no `src/`, no `package.json`, no tests — only OpenSpec artifacts. The entire intended system
(architecture, ES queries, REST contract, env surface) is fully specified under:

```
openspec/changes/advanced-search-system/
  proposal.md   # Why + What (motivation, capability list, impact)
  design.md     # Decisions D1–D12 — the authoritative technical design
  tasks.md      # Ordered implementation checklist (16 groups, [ ] units)
  specs/<capability>/spec.md   # Requirements + WHEN/THEN scenarios (acceptance criteria)
```

Before implementing anything, read those files. When they disagree, precedence is:
**spec scenarios** (acceptance criteria) → **design.md** (how) → **tasks.md** (order) → proposal (context).

## Working via OpenSpec

Implementation is driven by the OpenSpec workflow (skills/commands under `.claude/`), not ad-hoc coding.

- To implement: `/opsx:apply advanced-search-system` (or the `openspec-apply-change` skill). It reads the
  context files, works `tasks.md` top-to-bottom, and flips each `- [ ]` to `- [x]` as it lands.
- Inspect state: `openspec status --change advanced-search-system --json` and
  `openspec instructions apply --change advanced-search-system --json`.
- Validate artifacts: `openspec validate --change advanced-search-system`.
- **tasks.md ordering is deliberate**: groups 1–6 deliver an end-to-end `GET /search` vertical slice first
  (the brief rewards "functional + well-documented" over completeness); facets, autocomplete, suggestions,
  caching, and health layer on top. Do not reorder without reason.
- If implementation reveals a design gap, pause and update the artifact (design/spec), don't silently diverge.

## Planned stack & commands (do not exist until group 1 lands)

NestJS + TypeScript, Elasticsearch, Redis. Per `tasks.md` §1.2 the npm scripts will be:
`start`, `start:dev`, `build`, `test` (Jest unit), `test:e2e` (Supertest), `lint`, `seed`.
Seeding runs a Nest standalone context that provisions the index then bulk-loads the dataset (`npm run seed`).
Delivery includes a multi-stage `Dockerfile` + `docker-compose` (API + Elasticsearch + Redis) and a Postman collection.

## Intended architecture (strict hexagonal)

Four layers, dependencies point inward only:

```
domain  →  application (use-cases + ports)  →  infrastructure (ES/Redis adapters)
                                            →  presentation (HTTP controllers + DTOs)
```

Hard rules that shape every file (see design.md D9–D10):

- **Dependency inversion via `Symbol` tokens + `@Inject`.** Each port is an `interface` + a `Symbol` token
  (`PRODUCT_SEARCH_PORT`, `AUTOCOMPLETE_PORT`, `QUERY_SUGGESTION_PORT`, `PRODUCT_INDEX_PORT`, `CACHE_PORT`,
  health probe). Wire with `{ provide: TOKEN, useClass: Adapter }`. Use-cases depend **only on tokens** —
  never import an infrastructure class and never inject a bare TS interface as a provider.
- **Ports must not leak Elasticsearch types.** Domain/application models (`SearchCriteria`, `SearchOutcome`,
  `Facets`, `ProductSummary`, `QuerySuggestion`, …) are the currency across the boundary; ES/Redis types stay
  inside infrastructure adapters.
- **Domain is framework-free** and enforces invariants (`Product`: non-empty name, `price >= 0`,
  `popularity >= 0`; `Money` value object).
- **Presentation**: `class-validator` DTOs behind a global
  `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`, and a global `AllExceptionsFilter` mapping
  domain→400/404/422, ES/Redis upstream→502/503, validation→400, into
  `{ statusCode, error, message, details?, timestamp, path }`. No unhandled 500s. Controllers return
  **response DTOs** mapped from domain models (never serialize an entity). The edge adds **Helmet** (CSP off
  for a JSON API) and **env-aware CORS** via `CORS_ORIGINS` (D13).

## The non-obvious design decisions

These are the parts that are easy to get wrong and worth internalizing before touching search code:

- **One Elasticsearch round-trip returns hits + facets + "did you mean".** Don't split into multiple `_search`
  calls. Encapsulated in a single infrastructure `SearchQueryBuilder`.
- **Faceting = the hard part (D4).** Facet filters go in **`post_filter`** (so they constrain the *hits*), NOT
  in the scoring `query` (which defines the aggregation universe as "everything matching the text query").
  Each facet's count comes from a `filter` sub-aggregation applying **all other** selected filters **except its
  own dimension** — so a user can broaden a dimension they already narrowed. This "exclude own dimension" rule
  is the highest-risk logic; it gets table-driven unit tests across every filter combination.
- **Relevance (D3)**: `multi_match` (BM25, field boosts, `fuzziness: AUTO`, `minimum_should_match`) wrapped in
  `function_score` (popularity `field_value_factor` + recency `gauss`, `boost_mode: multiply`). Empty `q` ⇒
  `match_all` browse mode. Boost weights / recency scale are **env-configurable** (tunable without redeploy).
- **Redis cache is strictly cache-aside and fail-open (D8).** Any Redis error is logged and the use-case falls
  through to Elasticsearch — a cache outage must NEVER fail a request. Keys are namespaced with an
  index-version token so an alias flip invalidates everything.
- **Index behind an alias (D1).** Physical `products_v1`, read/written via the `products` alias, for
  zero-downtime reindex + trivial rollback. `ensureIndex()` is idempotent (create mapping + alias if absent).
- **Pagination stability (D5)**: every sort appends a deterministic tiebreaker; `from+size` beyond
  `max_result_window` (10 000) ⇒ **422**; page size over the configured max ⇒ **400**.
- **Config is env-driven and fail-fast (D12)**: a **Zod**-validated schema (`z.infer` types the config);
  adapters read a typed config accessor,
  never `process.env` directly. The **same code path runs locally and against managed cloud** (Elastic Cloud +
  Upstash Redis + a container host); the ES client factory selects API-key vs. basic auth and TLS from env.
  Nothing may assume `localhost`.

## REST contract (target)

`GET /search`, `GET /autocomplete`, `GET /suggest`, `GET /health`. Full parameter list, response envelopes
(`{ data, meta, facets, suggestions }`), and status-code semantics are in **design.md D11**; per-endpoint
acceptance scenarios are in `specs/*/spec.md`. Inside `/search`, the `suggestions` block is populated **only on
low recall** (hits ≤ `SEARCH_SUGGEST_MAX_HITS`); `GET /suggest` always returns suggestions.

## Conventions

- **Conventional commits**, one per task group (never a single mega-commit).
- **All code, comments, and artifacts in English.** (Conversation with the user is in Spanish.)
- **Strong typing**: `@typescript-eslint/no-explicit-any` is an **error**; any escape hatch needs an inline
  justification + a backing type. **No file exceeds ~250 lines** — split by responsibility (the ES query
  builder is four focused builders: query / filter / facet-aggregations / sort).
- **DI only** via `Symbol` tokens; never `new SomeService()`. Dependencies point inward; no circular deps.
- **Output DTOs**: never return a domain entity from a controller — map to a response DTO.
- **Docs source of truth = code**: README/Postman describe only shipped behavior. OpenSpec specs are the *plan*
  and may lead the code until the change is archived.
- **Tests**: AAA; unit `*.spec.ts` co-located beside the code, e2e under `test/`. Unit-test use-cases with
  mocked ports and the `SearchQueryBuilder`; integration-test the
  Elasticsearch adapter against a real ES (docker-compose/testcontainers); e2e-test the endpoints including
  edge cases (validation 400, window 422, engine-down 503, cache fail-open).
