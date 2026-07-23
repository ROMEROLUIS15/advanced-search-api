## ADDED Requirements

### Requirement: Prefix autocomplete
The system SHALL expose `GET /autocomplete?q=<prefix>` returning product-name completions that match the
prefix (including infix matches), ordered by relevance and limited by an optional `limit` parameter.

#### Scenario: Prefix returns completions
- **WHEN** a client requests `GET /autocomplete?q=dri`
- **THEN** the response status is 200
- **AND** `data` contains name completions that begin with or contain "dri"

#### Scenario: Limit is respected
- **WHEN** a client requests `GET /autocomplete?q=dri&limit=5`
- **THEN** at most 5 completions are returned

#### Scenario: Empty or missing prefix rejected
- **WHEN** `q` is empty or missing
- **THEN** the response status is 400

### Requirement: Autocomplete caching
The system SHALL cache autocomplete responses in Redis keyed by the normalized prefix with a short
configurable TTL, and MUST fail open on cache errors.

#### Scenario: Cached prefix served from cache
- **WHEN** the same prefix is requested twice within the TTL
- **THEN** the second response is served from cache and is equivalent to the first

#### Scenario: Cache down degrades gracefully
- **WHEN** Redis is unavailable
- **THEN** autocomplete still returns results from Elasticsearch with status 200
