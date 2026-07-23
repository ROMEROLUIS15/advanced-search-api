## ADDED Requirements

### Requirement: Health and readiness endpoint
The system SHALL expose `GET /health` reporting the connectivity status of Elasticsearch and Redis in a
typed body suitable for container health probes. Elasticsearch SHALL be treated as a critical dependency:
the endpoint SHALL return 503 when it is unreachable. Redis SHALL be treated as non-critical: its outage
SHALL be reported but SHALL NOT by itself fail readiness.

#### Scenario: All dependencies healthy
- **WHEN** Elasticsearch and Redis are both reachable
- **THEN** `GET /health` returns 200 with each dependency reported as "up"

#### Scenario: Critical dependency down
- **WHEN** Elasticsearch is unreachable
- **THEN** `GET /health` returns 503 indicating Elasticsearch is down

#### Scenario: Non-critical dependency degraded
- **WHEN** Redis is unreachable but Elasticsearch is healthy
- **THEN** `GET /health` returns 200, reports Redis as "down", and search endpoints remain functional
