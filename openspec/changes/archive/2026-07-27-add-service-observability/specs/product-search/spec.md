## MODIFIED Requirements

### Requirement: Hot-result caching
The system SHALL cache hot search responses in Redis using a cache-aside strategy, keyed by the
normalized request parameters, with a configurable TTL. Caching MUST be fail-open: a cache error MUST
NOT fail the request. Concurrent misses for the same key MUST result in a single upstream load rather than
one per caller, and the stored TTL MUST be spread so that entries populated together do not expire together.
A cached entry whose stored shape does not match what the service expects MUST be treated as a miss rather
than served. Responses SHALL declare an explicit cache policy to clients.

#### Scenario: Cache hit on repeated request
- **WHEN** an identical search request is repeated within the TTL
- **THEN** the second response is served from cache and is equivalent to the first

#### Scenario: Cache failure degrades gracefully
- **WHEN** Redis is unavailable
- **THEN** the search still returns correct results from Elasticsearch with status 200

#### Scenario: Concurrent misses collapse into one upstream load
- **WHEN** several identical searches miss the cache at the same time
- **THEN** Elasticsearch is queried once and every caller receives that result

#### Scenario: Entries populated together do not expire together
- **WHEN** multiple distinct entries are written to the cache in the same moment
- **THEN** their expiry times differ, so their reloads do not coincide

#### Scenario: A cached payload of the wrong shape is not served
- **WHEN** the value stored for a key does not match the expected response shape
- **THEN** it is treated as a cache miss and the result is loaded from Elasticsearch

#### Scenario: Responses state their cache policy
- **WHEN** a client receives a search response
- **THEN** the response carries an explicit `Cache-Control` header

### Requirement: Search input validation and error handling
The system SHALL validate all query parameters and SHALL reject invalid input with a typed 400 error.
Free-text and filter parameters MUST be bounded in length, and a price range whose lower bound exceeds its
upper bound MUST be rejected rather than silently returning no results. Upstream search-engine failures
SHALL surface as a typed 502/503 error, never as an unhandled 500; a rejection returned *by* the search
engine for a malformed query MUST be reported as a client error, not as an upstream failure.

#### Scenario: Invalid numeric parameter
- **WHEN** the request sets `minPrice=abc`
- **THEN** the response status is 400 with field-level details

#### Scenario: Unknown parameter rejected
- **WHEN** a request includes a parameter outside the allowed set
- **THEN** the response status is 400

#### Scenario: Over-long free text rejected
- **WHEN** the request sets `q` to a value longer than the configured maximum
- **THEN** the response status is 400 with field-level details, and the value never reaches Elasticsearch

#### Scenario: Inverted price range rejected
- **WHEN** the request sets `minPrice=500` and `maxPrice=10`
- **THEN** the response status is 400 rather than 200 with an empty result set

#### Scenario: Search engine rejects the query
- **WHEN** Elasticsearch answers 400 for the query built from the request
- **THEN** the response status is 400, not 502

#### Scenario: Search engine unavailable
- **WHEN** Elasticsearch is unreachable
- **THEN** the response status is 503 with a typed error body
