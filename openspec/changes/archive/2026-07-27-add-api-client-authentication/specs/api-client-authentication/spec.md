## ADDED Requirements

### Requirement: API key required on every client endpoint
The system SHALL reject any request to a client endpoint that does not carry a valid API key, with status
**401** and the standard error body. A valid key is one of the configured keys, presented in the `X-API-Key`
request header. The published API contract (`/docs`, `/docs-json`) is a client endpoint for this purpose.

#### Scenario: Request without a key
- **WHEN** a client requests `GET /search?q=drill` with no `X-API-Key` header
- **THEN** the response status is 401 and no search is performed

#### Scenario: Request with an unknown key
- **WHEN** a client requests `GET /search?q=drill` with an `X-API-Key` that is not configured
- **THEN** the response status is 401

#### Scenario: Request with a valid key
- **WHEN** a client requests `GET /search?q=drill` with a configured `X-API-Key`
- **THEN** the request is served normally

#### Scenario: The contract is not public either
- **WHEN** an anonymous client requests `GET /docs-json`
- **THEN** the response status is 401

### Requirement: Operator endpoints are outside the API-key scheme
The system SHALL serve `GET /health` without any credential, whatever the authentication configuration: the
platform's readiness probe cannot present one, and a probe answering 401 would be read as an unhealthy instance
and take the deployment down. `GET /metrics` SHALL likewise be outside this scheme, because it carries its own
bearer token — one audience, one credential, rotated on its own schedule.

#### Scenario: Probe without credentials
- **WHEN** the platform requests `GET /health` with no headers
- **THEN** the response is the normal health report, never 401

#### Scenario: The scrape endpoint keeps its own credential
- **WHEN** a scraper requests `GET /metrics` with its bearer token and no API key
- **THEN** the metrics are returned, and the API key is never required of it

#### Scenario: The scrape endpoint is still not open
- **WHEN** a caller requests `GET /metrics` with a valid API key but no bearer token
- **THEN** the response status is 401

### Requirement: Secure by default
Authentication SHALL be enabled unless it is explicitly disabled. A configuration that enables authentication
without providing at least one key MUST fail at startup rather than start with an open API.

#### Scenario: Enabled with no keys configured
- **WHEN** the service starts with authentication enabled and an empty key list
- **THEN** startup fails with a validation error naming the missing variable

#### Scenario: Explicitly disabled
- **WHEN** the service starts with authentication explicitly disabled
- **THEN** it serves every endpoint without requiring a key

#### Scenario: Nothing configured at all
- **WHEN** the service starts with neither variable set
- **THEN** authentication is enabled, so startup fails for want of a key rather than exposing the API

### Requirement: Keys are handled as credentials
Key comparison SHALL be constant-time, so a caller cannot discover a key by measuring response times. A key
MUST NOT appear in logs, error messages or traces.

#### Scenario: Rejection reveals nothing
- **WHEN** a request is rejected for an invalid key
- **THEN** the response body states only that a valid key is required, and the presented key appears nowhere in
  the response or the logs

#### Scenario: Several keys are accepted
- **WHEN** more than one key is configured and a client presents the second one
- **THEN** the request is served, so a key can be rotated by adding the new one before removing the old
