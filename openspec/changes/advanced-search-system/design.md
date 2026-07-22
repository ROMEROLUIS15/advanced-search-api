## Context

This change delivers a standalone **Advanced Product Search API** for "Factory" (product/manufacturer
discovery). It is a greenfield NestJS service with no frontend and no relational store of its own — its
system of record for search is a single Elasticsearch index. Redis is a side cache. The service is judged
on a *functional, well-documented vertical slice* over raw completeness, clean hexagonal architecture,
performance, and edge-case handling.

Constraints that shape the design:
- **Hexagonal, strict layering**: `domain` → `application` (use-cases + ports) → `infrastructure`
  (Elasticsearch + Redis adapters) → `presentation` (HTTP). Dependency inversion via `Symbol` tokens +
  `@Inject`; use-cases never import an infrastructure class or a bare TS interface as a provider.
- **Deploy online is mandatory**: the design must work against *managed* Elasticsearch (Elastic Cloud /
  Bonsai) and *managed* Redis (Upstash) over TLS with API keys, driven entirely by environment variables,
  and run in a container host (Render / Railway). Nothing may assume `localhost`.
- **Small effort budget** (2–3 days): favor one well-built ES query that returns hits + facets + "did you
  mean" in a single round-trip over many micro-services.

Reference: see `proposal.md` for motivation and the capability list; per-capability requirements live in
`specs/`.

## Goals / Non-Goals

**Goals:**
- A single `GET /search` that returns relevance-ranked hits, facets, pagination metadata, and a
  "did you mean" block from **one** Elasticsearch request.
- Correct **faceting semantics**: each facet's counts reflect every *other* active filter but not its own
  selection (so a user can widen within a dimension).
- Typo-tolerant **autocomplete** and **query suggestions**, cached in Redis, that fail *open* (a Redis
  outage degrades to Elasticsearch, never to an error).
- A **seed** path that provisions the index (mapping + analyzers) and bulk-loads a realistic dataset,
  idempotently, both locally and against a managed cluster.
- **Environment-driven** configuration validated at boot; identical code path local vs. cloud.

**Non-Goals:**
- No frontend, no authentication/authorization (endpoints are public for the challenge; API-key gating is
  noted as a future extension).
- No write API for products beyond the seed/reindex tooling (search is read-only).
- No multi-currency or multi-language analysis (assume a single currency and an English-leaning analyzer).
- No real-time indexing pipeline / CDC — the dataset is loaded by the seed job.
- No deep-pagination beyond Elasticsearch's `max_result_window`; `search_after` is deferred.

## Decisions

### D1 — One index, versioned behind an alias
A single index holds the `Product` document. Physical indices are versioned (`products_v1`) and read/written
through an alias (`products`). This enables zero-downtime reindex (build `products_v2`, flip the alias) and a
trivial rollback (flip it back). For the challenge dataset, **1 primary shard, 0 replicas** keeps trial
clusters green and scoring deterministic.
*Alternative considered:* index directly by name — rejected because remapping (analyzers change often during
tuning) would force downtime or a delete/recreate.

### D2 — Field mapping & analyzers
Multi-field mapping so each field serves both **matching** (analyzed `text`) and **filtering/faceting**
(`keyword`), plus dedicated sub-fields for autocomplete and suggestions.

```jsonc
// settings.analysis
{
  "analyzer": {
    "text_std": { "type": "custom", "tokenizer": "standard",
                  "filter": ["lowercase", "asciifolding"] },
    "text_en":  { "type": "custom", "tokenizer": "standard",
                  "filter": ["lowercase", "asciifolding", "english_stop", "english_stemmer"] },
    "shingle_analyzer": { "type": "custom", "tokenizer": "standard",
                  "filter": ["lowercase", "asciifolding", "shingle_2_3"] }
  },
  "filter": {
    "english_stop":    { "type": "stop", "stopwords": "_english_" },
    "english_stemmer": { "type": "stemmer", "language": "light_english" },
    "shingle_2_3":     { "type": "shingle", "min_shingle_size": 2, "max_shingle_size": 3 }
  }
}
```

```jsonc
// mappings.properties
{
  "id":          { "type": "keyword" },
  "name":        { "type": "text", "analyzer": "text_en",
                   "fields": {
                     "std":     { "type": "text", "analyzer": "text_std" },
                     "kw":      { "type": "keyword" },
                     "suggest": { "type": "search_as_you_type", "analyzer": "text_std" }
                   } },
  "description": { "type": "text", "analyzer": "text_en" },
  "category":    { "type": "keyword", "fields": { "text": { "type": "text", "analyzer": "text_en" } } },
  "subcategories": { "type": "keyword", "fields": { "text": { "type": "text", "analyzer": "text_en" } } },
  "location":    { "type": "keyword", "fields": { "text": { "type": "text", "analyzer": "text_std" } } },
  "price":       { "type": "scaled_float", "scaling_factor": 100 },
  "popularity":  { "type": "integer" },
  "createdAt":   { "type": "date" },
  // aggregated free-text target for the suggesters:
  "suggest_text": { "type": "text", "analyzer": "text_std",
                    "fields": { "trigram": { "type": "text", "analyzer": "shingle_analyzer" } } }
}
```
`name`, `category`, `subcategories` use `copy_to: "suggest_text"` so term/phrase suggesters draw from a
clean corpus. `price` uses `scaled_float` (currency-safe, avoids float drift). `keyword` sub-fields drive
filters and `terms` aggregations; `.text` sub-fields feed relevance scoring.
*Alternative considered:* `completion` suggester field for autocomplete — rejected as the primary mechanism
because it needs pre-built weighted `input` arrays at index time and does not do infix matching;
`search_as_you_type` matches mid-phrase out of the box and reuses the analyzed `name`. Kept as a documented
future option for curated suggestions.

### D3 — Relevance: BM25 + `function_score`
Text relevance uses `multi_match` (BM25 under the hood) with field boosts; business signals are folded in
with `function_score` (`boost_mode: multiply`) so a popular, recent product outranks a stale one at equal
textual relevance.

```jsonc
{
  "function_score": {
    "query": {
      "bool": {
        "must": [{
          "multi_match": {
            "query": "<q>",
            "type": "best_fields",
            "fields": ["name^4", "name.std^2", "category.text^2",
                       "subcategories.text^1.5", "location.text^1", "description^1"],
            "fuzziness": "AUTO", "operator": "or", "minimum_should_match": "60%"
          }
        }]
        // NOTE: facet filters are NOT here — see D4 (post_filter)
      }
    },
    "functions": [
      { "field_value_factor": { "field": "popularity", "modifier": "ln1p", "factor": 1 } },
      { "gauss": { "createdAt": { "origin": "now", "scale": "90d", "offset": "7d", "decay": 0.5 } } }
    ],
    "score_mode": "sum", "boost_mode": "multiply"
  }
}
```
When `q` is empty (browse mode) the `must` becomes `match_all` and ranking falls to the chosen sort (default
popularity). Boost weights, recency scale, and the popularity factor are **env-configurable** so relevance
can be tuned without a redeploy. *Alternative considered:* `rank_feature`/`distance_feature` — cleaner but
less transparent to explain in the README; `function_score` is the didactic, well-documented choice.

### D4 — Filtering & faceting semantics (the key ES design)
All facet filters (category, subcategory, location, price range) are applied as **`post_filter`**, not inside
the scoring `query`. This lets the returned *hits* respect every selection while the aggregation scope stays
at "everything matching the text query." Each facet is then computed inside a `filter` aggregation that
applies **all other** selected filters **except its own dimension** — the standard recipe for facets that
let you broaden a dimension you've already narrowed.

```
query        = text query only (D3)                → defines the agg universe
post_filter  = AND(all selected facet filters)     → constrains the hits only
aggs:
  by_category    = filter(AND of filters EXCEPT category)     → terms(category)
  by_subcategory = filter(AND of filters EXCEPT subcategories)→ terms(subcategories)
  by_location    = filter(AND of filters EXCEPT location)     → terms(location)
  by_price       = filter(AND of filters EXCEPT price)        → range(price, [buckets])
```
This is encapsulated in a single `SearchQueryBuilder` (infrastructure) with focused unit tests, because the
"exclude own dimension" rule is the most error-prone part of the system. Filters run in **filter context**
(no scoring, cacheable). Price ranges are configurable buckets (e.g. `0–50, 50–100, 100–500, 500+`) plus an
optional caller-supplied `min/max` range filter.
*Alternative considered:* separate `_search` per facet — rejected (N+1 round-trips); a single request with
filtered sub-aggs is both correct and fast.

### D5 — Sorting & pagination
Sort options: `relevance` (`_score`), `popularity`, `created_at`, each with `order` asc/desc. Every sort
appends a deterministic tiebreaker (`_score` then `id`) so pagination is **stable** (no duplicate/skipped
docs across pages). Pagination is `from`/`size`; `size` is capped (env, default 20, max 100) and `from+size`
is guarded against `index.max_result_window` (10 000) with a `422`. `track_total_hits` is capped so total
counts stay cheap. `search_after` is documented as the path beyond 10k (non-goal now).

### D6 — Autocomplete
`GET /autocomplete` queries `name.suggest` (`search_as_you_type`) with a `bool_prefix` multi-match across its
`_2gram`/`_3gram` sub-fields, returning distinct product-name completions. Results are cached in Redis
(cache-aside) keyed by normalized prefix; TTL is short (env, default 60s). The Redis lookup is **fail-open**:
any cache error is logged and the request proceeds to Elasticsearch.
*Alternative considered:* `completion` suggester — faster but prefix-only and needs curated inputs; SAYT
better fits free-form product names (see D2).

### D7 — "Did you mean" & related queries
`GET /suggest` and the `didYouMean` block inside `/search` use Elasticsearch **term** + **phrase** suggesters
over `suggest_text` / `suggest_text.trigram`. The phrase suggester (with a `direct_generator` and
`max_errors`) produces a corrected full-query suggestion; the term suggester provides per-token alternatives
for "related queries." Inside `/search`, the block is only populated on **low recall** (0 or few hits) to
avoid noise. A `collate` query ensures suggested phrases actually return documents.

### D8 — Redis caching strategy
Cache-aside with a **namespaced key** that includes an index-version token, so a reindex/alias flip
invalidates all cached entries at once (`v{N}:search:{sha1(normalized_params)}`). Two families:
`search:*` (hot result pages, TTL default 300s) and `ac:*` (autocomplete prefixes, TTL default 60s). Caching
is a pure optimization: on any Redis error the use-case falls through to the search port (fail-open), and
writes are best-effort. Only cache non-personalized, deterministic responses.

### D9 — Ports & contracts (application layer)
Each port is an `interface` bound to a `Symbol` token; adapters live in infrastructure and are wired in the
Nest module with `{ provide: TOKEN, useClass: Adapter }`. Use-cases depend only on tokens.

```ts
// application/ports/product-search.port.ts
export const PRODUCT_SEARCH_PORT = Symbol('PRODUCT_SEARCH_PORT');
export interface ProductSearchPort {
  // single ES round-trip: hits + facets + optional did-you-mean
  search(criteria: SearchCriteria): Promise<SearchOutcome>;
}

export const AUTOCOMPLETE_PORT = Symbol('AUTOCOMPLETE_PORT');
export interface AutocompletePort {
  complete(prefix: string, limit: number): Promise<AutocompleteItem[]>;
}

export const QUERY_SUGGESTION_PORT = Symbol('QUERY_SUGGESTION_PORT');
export interface QuerySuggestionPort {
  suggest(text: string): Promise<QuerySuggestion[]>;
}

export const PRODUCT_INDEX_PORT = Symbol('PRODUCT_INDEX_PORT');
export interface ProductIndexPort {
  ensureIndex(): Promise<void>;          // idempotent: create mapping + alias if absent
  bulkIndex(products: Product[]): Promise<BulkResult>;
  refresh(): Promise<void>;
  count(): Promise<number>;
}

export const CACHE_PORT = Symbol('CACHE_PORT');
export interface CachePort {             // generic, fail-open at the use-case boundary
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
}

export const HEALTH_PORT = Symbol('HEALTH_PORT'); // one per dependency, or Terminus indicators
export interface HealthProbePort { name: string; ping(): Promise<DependencyHealth>; }
```
Domain-facing input/result models (`SearchCriteria`, `SearchOutcome`, `Facets`, `FacetBucket`,
`PriceRangeBucket`, `QuerySuggestion`, `ProductSummary`) live in `application`/`domain`, not in
infrastructure, so ports never leak Elasticsearch types.

### D10 — Use-cases, domain, presentation
- **Domain**: `Product` entity (invariants: non-empty `name`, `price >= 0`, `popularity >= 0`) and a `Money`
  value object; pure, framework-free.
- **Application use-cases** (one public method each): `SearchProductsUseCase` (cache-aside → `ProductSearchPort`),
  `AutocompleteUseCase`, `SuggestQueriesUseCase`, `SeedCatalogUseCase` / `ReindexUseCase` (used by the seed
  CLI), `CheckHealthUseCase`.
- **Presentation**: `SearchController` (`GET /search`), `AutocompleteController` (`GET /autocomplete`),
  `SuggestionController` (`GET /suggest`), `HealthController` (`GET /health`). DTOs use `class-validator`
  behind a global `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`. A global
  `AllExceptionsFilter` maps `DomainError`→400/404/422, upstream ES/Redis failures→502/503, validation→400,
  into a typed body `{ statusCode, error, message, details?, timestamp, path }`.

### D11 — REST contract
```
GET /search
  q?           string     free-text query (omit ⇒ browse mode)
  category?    string     exact category (keyword)
  subcategory? string[]   repeatable / CSV; ANY-of match on subcategories
  location?    string     exact location (keyword)
  minPrice?    number     inclusive
  maxPrice?    number     inclusive
  sort?        relevance|popularity|created_at   (default relevance; popularity when q empty)
  order?       asc|desc                          (default desc)
  page?        integer >=1  (default 1)
  pageSize?    integer 1..100 (default 20)
  → 200 {
      data: ProductSummary[],
      meta: { total, page, pageSize, totalPages, sort, order },
      facets: { categories:[{key,count}], subcategories:[...], locations:[...],
                priceRanges:[{from,to,count}] },
      suggestions: { didYouMean: string|null, related: string[] }   // populated on low recall
    }

GET /autocomplete?q=<prefix>&limit=<1..20 default 10>
  → 200 { data: [{ text, score }] }         // q min length 1

GET /suggest?q=<text>
  → 200 { data: { didYouMean: string|null, related: string[] } }

GET /health
  → 200 { status:"ok", info:{ elasticsearch:{status}, redis:{status} } }
  → 503 { status:"error", ... }             // when a critical dependency is down
```
Invalid params ⇒ `400` with field-level `details`. `from+size > 10000` ⇒ `422`.

### D12 — Configuration (fail-fast at boot)
`ConfigModule` with a validated schema (**Zod**, wired as a custom `validate` function). Zod is chosen over
Joi so `z.infer` yields the strongly-typed config from a single source (no hand-maintained interface). Env
surface (local vs. cloud differ only in values):
```
NODE_ENV, PORT
CORS_ORIGINS                  # comma-separated allowed origins (empty in prod ⇒ same-origin only)
ELASTICSEARCH_NODE            # https URL or Elastic Cloud endpoint
ELASTICSEARCH_API_KEY         # base64 API key (cloud); or ELASTICSEARCH_USERNAME/PASSWORD (local)
ELASTICSEARCH_INDEX=products  # alias name
ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED=true
REDIS_URL                     # redis:// local, rediss:// (TLS) for Upstash
CACHE_TTL_SEARCH=300  CACHE_TTL_AUTOCOMPLETE=60
SEARCH_DEFAULT_PAGE_SIZE=20  SEARCH_MAX_PAGE_SIZE=100
SEARCH_SUGGEST_MAX_HITS=5     # /search surfaces "did you mean" only at/below this hit count
RELEVANCE_POPULARITY_FACTOR=1  RELEVANCE_RECENCY_SCALE=90d  RELEVANCE_RECENCY_DECAY=0.5
```
The Elasticsearch client factory selects auth (API key vs. basic) and TLS from env, so the same adapter runs
on a local docker container and on Elastic Cloud. Boot fails with a clear message if required vars are missing.

### D13 — HTTP hardening: security headers, CORS, and response DTOs
The HTTP edge is hardened without introducing authentication (still a non-goal):
- **Helmet** sets standard security headers. `contentSecurityPolicy` is **disabled** — this is a JSON API with
  no browser-rendered HTML, so a CSP would only add noise.
- **CORS** is **environment-aware**: the allowed-origin list comes from `CORS_ORIGINS` (comma-separated). When
  unset in non-production it reflects the request origin for easy local testing; in production an empty list
  means same-origin only. Never a hard-coded `*` in production.
- **Response DTOs**: controllers return explicit response DTOs mapped from domain/application models via a
  dedicated mapper — a domain entity is **never** serialized directly, so internal fields cannot leak. Input
  DTOs (D10) guard what comes in; response DTOs guard what goes out.

## Risks / Trade-offs

- **Facet "exclude own dimension" logic is subtle** → isolate it in `SearchQueryBuilder` with table-driven
  unit tests covering every filter combination; document the recipe (D4) in code comments.
- **Deep pagination capped at 10k** (`max_result_window`) → guard with `422` and document `search_after` as
  the scale path; acceptable for the challenge dataset.
- **Managed-cluster trial limits / cold starts** (Elastic Cloud, Upstash free tiers) → single shard, small
  seed dataset, generous client timeouts, `/health` readiness so the host waits for green.
- **Redis as a hard dependency risk** → cache is strictly cache-aside and **fail-open**; a Redis outage
  never fails a search. `/health` still reports Redis so operators see degradation.
- **Fuzzy matching + suggesters cost CPU** → bounded `fuzziness: AUTO`, `max_errors` on the phrase suggester,
  suggestions only on low recall, and Redis caching of hot queries.
- **Single ES request couples hits+facets+suggest** → intentional (one round-trip is faster and simpler);
  the capabilities stay independently specified even though one adapter call satisfies several.
- **Analyzer choice is English-leaning** → fine for the seed dataset; multi-language is an explicit non-goal.

## Migration Plan

Greenfield, so "migration" = initial provisioning + seed; rollback = alias flip + previous image.

1. **Provision managed services**: Elastic Cloud (or Bonsai) → capture endpoint + API key; Upstash Redis →
   capture `rediss://` URL. Set all env vars in the container host (Render/Railway).
2. **Deploy the container** from the multi-stage image. On boot the app calls `ProductIndexPort.ensureIndex()`
   (idempotent: creates `products_v1` + `products` alias with the D2 mapping if absent).
3. **Seed** once via the release/one-off job: `npm run seed` (or a guarded admin command) bulk-indexes the
   dataset into the alias and `refresh()`es. Idempotent by document `id`.
4. **Verify** `GET /health` is `200` and `GET /search?q=...` returns hits + facets.
5. **Rollback**:
   - *Data/mapping*: build `products_v2`, reindex/seed, flip the alias; revert by flipping back to `v1`.
   - *App*: redeploy the previous image tag. Config is externalized, so no code change is needed to change
     endpoints or credentials.

## Resolved Decisions

- **Online target trio: Elastic Cloud (trial) + Upstash (Redis) + Render (container host).** Confirmed.
  Affects only env values and README steps, not code (the client factories are env-driven).
- **Currency: single implicit currency, USD.** `price` is stored as a plain numeric value via
  `scaled_float` (2-decimal precision, no float drift); no currency is hard-coded in the index. The `Money`
  value object MAY carry a `currency` field defaulting to `"USD"`, but range filtering/sorting uses the
  number only. Multi-currency is out of scope.
- **Suggestions surfacing: low-recall-only inside `/search`.** The term/phrase suggester runs in the *same*
  single ES request (one round-trip, negligible cost on the seed dataset), but `suggestions.didYouMean` is
  populated only when hits fall below a configurable threshold (`SEARCH_SUGGEST_MAX_HITS`, default e.g. 5).
  The dedicated `GET /suggest` endpoint always returns suggestions.
- **Engineering conventions (agreed before implementation).** Config validation uses **Zod** (`z.infer` =
  single source of truth for the config type). The HTTP edge is hardened with **Helmet + env-aware CORS** and
  **response DTOs** (D13). Code quality: `@typescript-eslint/no-explicit-any` is an **error** (escaped only
  inline with a written justification + a backing type); **no file exceeds ~250 lines** — which is why ES query
  construction is split into focused `query` / `filter` / `facet-aggregations` / `sort` builders rather than one
  monolith. Tests follow **AAA**; unit `*.spec.ts` are co-located beside the code they cover and e2e specs live
  in `test/`. Independent async work uses `Promise.all` / `Promise.allSettled` (e.g. parallel health probes),
  but the core `/search` stays a single ES round-trip and is intentionally not parallelized.

## Open Questions

- Curated autocomplete (weighted `completion` suggester) vs. the current `search_as_you_type` — deferred;
  revisit only if ranking of completions needs manual control.
