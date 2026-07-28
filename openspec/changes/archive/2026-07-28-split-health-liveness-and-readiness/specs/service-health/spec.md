## MODIFIED Requirements

### Requirement: Health and readiness endpoint
The system SHALL expose `GET /health` reporting the connectivity status of Elasticsearch and Redis in a
typed body suitable for container health probes. Elasticsearch SHALL be treated as a critical dependency:
the endpoint SHALL return 503 when it is unreachable, and equally when the configured search index does not
exist, since a reachable cluster without the index cannot serve a single query. Redis SHALL be treated as
non-critical: its outage SHALL be reported but SHALL NOT by itself fail readiness. Probe failure details
SHALL NOT be disclosed in the response body. The endpoint SHALL remain reachable **without credentials**
even when the rest of the API requires them: a platform probe cannot present a key, and a probe answering
401 would be read as an unhealthy instance and take the deployment down.

#### Scenario: All dependencies healthy
- **WHEN** Elasticsearch and Redis are both reachable
- **THEN** `GET /health` returns 200 with each dependency reported as "up"

#### Scenario: Critical dependency down
- **WHEN** Elasticsearch is unreachable
- **THEN** `GET /health` returns 503 indicating Elasticsearch is down

#### Scenario: Critical dependency reachable but unusable
- **WHEN** Elasticsearch is reachable but the configured search index does not exist
- **THEN** `GET /health` returns 503, so a deployment against an unseeded cluster never becomes healthy

#### Scenario: Non-critical dependency degraded
- **WHEN** Redis is unreachable but Elasticsearch is healthy
- **THEN** `GET /health` returns 200, reports Redis as "down", and search endpoints remain functional

#### Scenario: Probe without credentials while the API is protected
- **WHEN** API authentication is enabled and the platform requests `GET /health` with no key
- **THEN** the health report is returned as usual, never a 401

## ADDED Requirements

### Requirement: Readiness endpoint for continuous platform polling
The system SHALL expose `GET /health/ready` reporting whether the service can serve traffic. It SHALL
evaluate **only the dependencies whose state can change the answer** — the critical ones — and MUST NOT call
any non-critical dependency. A platform polls this endpoint continuously and cannot be slowed down, so every
call it makes to a dependency is paid for thousands of times a day; a probe whose result is discarded is
therefore not merely redundant but a recurring cost. Readiness SHALL apply the same rules as the full report
for the dependencies it does evaluate, SHALL return 503 when any of them is down, and SHALL remain reachable
without credentials.

#### Scenario: Ready when the critical dependency is usable
- **WHEN** Elasticsearch is reachable and the configured index exists
- **THEN** `GET /health/ready` returns 200

#### Scenario: Not ready when the critical dependency is unusable
- **WHEN** Elasticsearch is unreachable, or its configured index does not exist
- **THEN** `GET /health/ready` returns 503

#### Scenario: A non-critical outage does not affect readiness
- **WHEN** Redis is unreachable and Elasticsearch is healthy
- **THEN** `GET /health/ready` returns 200

#### Scenario: Readiness does not touch non-critical dependencies
- **WHEN** `GET /health/ready` is served
- **THEN** no command is issued to any non-critical dependency, however many times it is polled

#### Scenario: Readiness without credentials while the API is protected
- **WHEN** API authentication is enabled and the platform requests `GET /health/ready` with no key
- **THEN** readiness is reported as usual, never a 401

### Requirement: Liveness endpoint free of dependencies
The system SHALL expose `GET /health/live` reporting only that the process is running and able to answer.
It MUST NOT call any dependency, so that a caller can distinguish a dead process from a running one whose
dependencies are degraded. It SHALL remain reachable without credentials.

#### Scenario: Alive regardless of dependency state
- **WHEN** the process is running and every dependency is unreachable
- **THEN** `GET /health/live` returns 200

#### Scenario: Liveness issues no dependency calls
- **WHEN** `GET /health/live` is served
- **THEN** no request is issued to Elasticsearch and no command is issued to Redis

### Requirement: Operator endpoints are exempt as a family
Every endpoint under the health path SHALL receive the same operator treatment the health endpoint receives:
exemption from client authentication, exemption from rate limiting, exclusion from request logging, and
exclusion from trace sampling. The exemption SHALL be expressed once so that adding an endpoint to the family
cannot leave one of the four behind, and SHALL NOT match unrelated paths that merely share a prefix.

#### Scenario: A new health sub-path inherits every exemption
- **WHEN** a request is made to any endpoint under the health path with no credentials
- **THEN** it is served without a 401, is not counted against a rate-limit budget, produces no request log
  line on success, and produces no trace

#### Scenario: A path that merely shares a prefix is not exempt
- **WHEN** a request is made to a path that begins with the health path's characters but is a different route
- **THEN** it receives the ordinary client treatment, including authentication and rate limiting
