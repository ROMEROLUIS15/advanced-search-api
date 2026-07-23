# request-rate-limiting Specification

## Purpose

Per-client, per-endpoint request rate limiting at the HTTP edge, so the public read endpoints cannot be
driven without bound against metered Elasticsearch and Redis. The counter is shared in Redis and falls over
to an in-process counter on a Redis outage, so protection survives the outage and Redis stays non-critical
(design D14). `GET /health` is exempt because the platform polls it as its readiness probe.

## Requirements

### Requirement: Per-endpoint request rate limiting
The system SHALL limit the number of requests a single client may make to each public endpoint within a
configurable time window. Each endpoint SHALL have its own independent budget, configurable by environment,
defaulting to 60 requests per minute for `GET /search` and `GET /suggest`, 300 requests per minute for
`GET /autocomplete`, and 120 requests per minute for any other limited route. A request that exceeds its
endpoint's budget SHALL be rejected with status **429** and MUST NOT reach Elasticsearch.

#### Scenario: Requests within the budget are served normally
- **WHEN** a client issues fewer requests to `GET /search` than the configured limit within one window
- **THEN** every request is served with its normal status and body
- **AND** no request is rejected

#### Scenario: Exceeding the budget is rejected with a typed 429
- **WHEN** a client exceeds the configured limit for `GET /search` within one window
- **THEN** the next request returns status 429
- **AND** the body is the project's standard error shape with `statusCode` 429 and a `timestamp` and `path`
- **AND** the request is not forwarded to Elasticsearch

#### Scenario: Budgets are independent per endpoint
- **WHEN** a client has exhausted its budget for `GET /search`
- **THEN** a request to `GET /autocomplete` is still served
- **AND** it is counted against the autocomplete budget only

#### Scenario: The budget replenishes when the window elapses
- **WHEN** a client has been rejected with 429 and the configured window has elapsed
- **THEN** a subsequent request is served normally

### Requirement: Health endpoint exemption
The system SHALL NOT rate limit `GET /health`. The endpoint is the container and platform readiness probe,
and throttling it could fail a deployment or remove a healthy instance from service.

#### Scenario: Health probing is never throttled
- **WHEN** `GET /health` is called far more times than any configured limit within one window
- **THEN** every call is answered with its normal readiness status
- **AND** no call returns 429

### Requirement: Rate limit headers
Every response to a limited endpoint SHALL advertise the client's remaining budget through `RateLimit-Limit`,
`RateLimit-Remaining` and `RateLimit-Reset`, so a client can slow down before being rejected. A 429 response
MUST additionally carry `Retry-After` indicating when the client may retry.

#### Scenario: A served response advertises the remaining budget
- **WHEN** a client issues a request to a limited endpoint within its budget
- **THEN** the response carries `RateLimit-Limit`, `RateLimit-Remaining` and `RateLimit-Reset`
- **AND** `RateLimit-Remaining` decreases as the client consumes its budget

#### Scenario: A rejected response tells the client when to retry
- **WHEN** a request is rejected with 429
- **THEN** the response carries `Retry-After`

### Requirement: Client identification behind a proxy
The system SHALL identify a client by its source address, resolved through a configurable number of trusted
proxy hops. When no proxy hop is trusted, a client-supplied forwarding header MUST NOT influence
identification, so a client cannot evade or impersonate a budget by forging it.

#### Scenario: Distinct clients hold distinct budgets behind a trusted proxy
- **WHEN** the service runs behind one trusted proxy hop
- **AND** two clients with different forwarded addresses issue requests
- **THEN** each client consumes only its own budget
- **AND** one client exhausting its budget does not cause the other to be rejected

#### Scenario: A forged forwarding header is ignored when no proxy is trusted
- **WHEN** no proxy hop is trusted
- **AND** a client sends a forwarding header claiming a different address on every request
- **THEN** all those requests count against the same budget

### Requirement: Counter store resilience
The counter SHALL be kept in Redis so that a limit is shared across instances. When Redis is unavailable the
system SHALL fall back to an in-process counter and keep enforcing the limit; it MUST NOT stop limiting, and
it MUST NOT reject or fail a request because the counter store is unreachable. Redis therefore remains a
non-critical dependency.

#### Scenario: Limiting continues while Redis is unavailable
- **WHEN** Redis is unreachable
- **AND** a client exceeds the configured limit for an endpoint
- **THEN** the excess request is still rejected with 429

#### Scenario: A store outage never fails an otherwise valid request
- **WHEN** Redis is unreachable
- **AND** a client issues a request within its budget
- **THEN** the request is served normally
- **AND** the response status is not 429 and not a 5xx caused by the counter store

#### Scenario: Shared counting resumes once Redis is reachable again
- **WHEN** Redis becomes reachable after an outage
- **THEN** subsequent requests are counted in Redis again

### Requirement: Switchable enforcement
Rate limiting SHALL be switchable by environment configuration so it can be disabled without a code change,
for load testing and as an operational rollback. Configuration SHALL be validated at boot like all other
settings, and the service MUST NOT assume any particular deployment environment.

#### Scenario: Enforcement can be turned off
- **WHEN** rate limiting is disabled by configuration
- **THEN** a client may exceed the otherwise configured limits without being rejected

#### Scenario: Invalid limit configuration fails fast at boot
- **WHEN** the service starts with a non-numeric or negative rate limit value
- **THEN** startup fails with a readable configuration error
