# service-health Specification

## Purpose

Dependency-aware readiness reporting for container health probes via `GET /health`, distinguishing the
critical dependency (Elasticsearch) from the non-critical one (Redis).
## Requirements
### Requirement: Health and readiness endpoint
The system SHALL expose `GET /health` reporting the connectivity status of Elasticsearch and Redis in a
typed body suitable for container health probes. Elasticsearch SHALL be treated as a critical dependency:
the endpoint SHALL return 503 when it is unreachable. Redis SHALL be treated as non-critical: its outage
SHALL be reported but SHALL NOT by itself fail readiness. The endpoint SHALL remain reachable **without
credentials** even when the rest of the API requires them: a platform probe cannot present a key, and a probe
answering 401 would be read as an unhealthy instance and take the deployment down.

#### Scenario: All dependencies healthy
- **WHEN** Elasticsearch and Redis are both reachable
- **THEN** `GET /health` returns 200 with each dependency reported as "up"

#### Scenario: Critical dependency down
- **WHEN** Elasticsearch is unreachable
- **THEN** `GET /health` returns 503 indicating Elasticsearch is down

#### Scenario: Non-critical dependency degraded
- **WHEN** Redis is unreachable but Elasticsearch is healthy
- **THEN** `GET /health` returns 200, reports Redis as "down", and search endpoints remain functional

#### Scenario: Probe without credentials while the API is protected
- **WHEN** API authentication is enabled and the platform requests `GET /health` with no key
- **THEN** the health report is returned as usual, never a 401

