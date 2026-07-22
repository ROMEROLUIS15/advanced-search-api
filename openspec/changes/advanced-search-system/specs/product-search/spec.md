## ADDED Requirements

### Requirement: Full-text product search
The system SHALL expose `GET /search` accepting an optional free-text query `q` and SHALL return
matching products ranked by relevance. The query SHALL match across product name, description,
category, subcategories, and location, and SHALL be typo-tolerant.

#### Scenario: Query matches product content
- **WHEN** a client requests `GET /search?q=drill`
- **THEN** the response status is 200
- **AND** `data` contains products whose name, description, category, subcategories, or location match "drill"

#### Scenario: Typo-tolerant matching
- **WHEN** a client requests `GET /search?q=dril` with a misspelling
- **THEN** the response includes products matching "drill" via fuzzy matching

#### Scenario: Browse mode with empty query
- **WHEN** a client requests `GET /search` with no `q`
- **THEN** the system returns products in browse mode (match all) ordered by the default sort
- **AND** the response status is 200

### Requirement: Filtering by attributes
The system SHALL support filtering results by category, subcategory, location, and price range.
Filters MUST be combinable and MUST also work individually. Filters MUST run in filter context and
MUST NOT influence relevance scoring.

#### Scenario: Single filter applied
- **WHEN** a client requests `GET /search?category=Tools`
- **THEN** only products in category "Tools" are returned

#### Scenario: Combined filters applied
- **WHEN** a client requests `GET /search?q=drill&category=Tools&location=Berlin&minPrice=50&maxPrice=200`
- **THEN** only products matching "drill" in category "Tools", location "Berlin", priced between 50 and 200 inclusive are returned

#### Scenario: Subcategory any-of match
- **WHEN** a client provides multiple `subcategory` values
- **THEN** products matching ANY of the provided subcategories are returned

#### Scenario: Price range boundaries are inclusive
- **WHEN** the request sets `minPrice=50` and `maxPrice=200`
- **THEN** a product priced exactly 50 or exactly 200 is included in the results

### Requirement: Relevance ranking
By default the system SHALL rank results by relevance, combining BM25 textual score with boosts for
popularity and recency, so that at comparable textual relevance a more popular and more recent product
ranks higher.

#### Scenario: Popularity boosts ranking
- **WHEN** two products have comparable textual match for `q`
- **THEN** the product with higher popularity ranks higher

#### Scenario: Recency boosts ranking
- **WHEN** two products have comparable textual match and popularity
- **THEN** the more recently created product ranks higher

### Requirement: Sorting options
The system SHALL support sorting by `relevance`, `popularity`, or `created_at`, each in `asc` or `desc`
order. Sorting MUST be deterministic with a stable tiebreaker so pagination neither duplicates nor skips
results.

#### Scenario: Sort by popularity
- **WHEN** a client requests `GET /search?sort=popularity&order=desc`
- **THEN** products are returned in descending popularity order

#### Scenario: Stable ordering across pages
- **WHEN** two products have equal sort values
- **THEN** their relative order is stable across paginated requests

#### Scenario: Invalid sort value rejected
- **WHEN** a client requests `GET /search?sort=color`
- **THEN** the response status is 400 with a validation error

### Requirement: Pagination
The system SHALL paginate results using `page` and `pageSize`, SHALL return pagination metadata
(`total`, `page`, `pageSize`, `totalPages`), and SHALL enforce a configurable maximum page size.
Requests that would read beyond the engine's maximum result window MUST be rejected.

#### Scenario: Default pagination
- **WHEN** a client requests `GET /search` without pagination params
- **THEN** page 1 is returned with the default page size
- **AND** `meta.total` reflects the total number of matches

#### Scenario: Page size cap enforced
- **WHEN** a client requests a `pageSize` above the configured maximum
- **THEN** the response status is 400

#### Scenario: Result window exceeded
- **WHEN** `page` and `pageSize` would require reading beyond the engine's maximum result window
- **THEN** the response status is 422 with an explanatory message

### Requirement: Hot-result caching
The system SHALL cache hot search responses in Redis using a cache-aside strategy, keyed by the
normalized request parameters, with a configurable TTL. Caching MUST be fail-open: a cache error MUST
NOT fail the request.

#### Scenario: Cache hit on repeated request
- **WHEN** an identical search request is repeated within the TTL
- **THEN** the second response is served from cache and is equivalent to the first

#### Scenario: Cache failure degrades gracefully
- **WHEN** Redis is unavailable
- **THEN** the search still returns correct results from Elasticsearch with status 200

### Requirement: Search input validation and error handling
The system SHALL validate all query parameters and SHALL reject invalid input with a typed 400 error.
Upstream search-engine failures SHALL surface as a typed 502/503 error, never as an unhandled 500.

#### Scenario: Invalid numeric parameter
- **WHEN** the request sets `minPrice=abc`
- **THEN** the response status is 400 with field-level details

#### Scenario: Unknown parameter rejected
- **WHEN** a request includes a parameter outside the allowed set
- **THEN** the response status is 400

#### Scenario: Search engine unavailable
- **WHEN** Elasticsearch is unreachable
- **THEN** the response status is 503 with a typed error body
