## ADDED Requirements

### Requirement: Structured application logging
The system SHALL emit every application log line as a single-line JSON object carrying at minimum a
timestamp, a level, the emitting context and the message. Logging MUST route through the existing Nest
`Logger` call sites, which MUST NOT need modification. In a non-production environment the system MAY
render the same records in a human-readable form.

#### Scenario: A request produces machine-readable logs
- **WHEN** the service handles any request in production configuration
- **THEN** each emitted log line parses as JSON and carries a timestamp, level, context and message

#### Scenario: Existing call sites keep working
- **WHEN** application code logs through `new Logger(Context)` as it does today
- **THEN** the record is emitted by the structured logger with that context, with no change to the call site

### Requirement: Request correlation id
The system SHALL associate every request with a correlation id. It MUST honour an inbound `X-Request-Id`
header when present and MUST generate one otherwise. Every log line emitted while handling that request —
including the completion line and any error line — MUST carry the same id, and the response MUST return it
to the client in an `X-Request-Id` header.

#### Scenario: Correlation id is generated
- **WHEN** a request arrives with no `X-Request-Id` header
- **THEN** the service generates an id, includes it in every log line for that request, and returns it in the
  `X-Request-Id` response header

#### Scenario: Inbound correlation id is honoured
- **WHEN** a request arrives with `X-Request-Id: abc-123`
- **THEN** the log lines for that request carry `abc-123` and the response echoes the same value

#### Scenario: Success and failure lines share the id
- **WHEN** a request ends in an error
- **THEN** the error line logged by the exception filter carries the same correlation id the request was
  handling under, so both sides of the request are queryable as one unit

### Requirement: Metrics endpoint
The system SHALL expose `GET /metrics` in Prometheus text exposition format, reporting request counts by
route and status, request duration as a histogram, Node process metrics, and counters for cache hits, cache
misses and rate-limit store fail-over events. The endpoint MUST be excluded from the published OpenAPI
document, being an operations endpoint rather than part of the client contract. When a metrics token is
configured the endpoint MUST require it and MUST answer 401 without it.

#### Scenario: Metrics are scrapeable
- **WHEN** a scraper requests `GET /metrics`
- **THEN** the response is 200 in Prometheus text format and includes request, duration and process metrics

#### Scenario: Cache behaviour is observable
- **WHEN** a search is served from cache and another misses the cache
- **THEN** the corresponding hit and miss counters in `/metrics` have increased

#### Scenario: Rate-limit degradation is observable
- **WHEN** the rate-limit store falls over from Redis to its in-process counter
- **THEN** the fail-over counter in `/metrics` has increased

#### Scenario: Metrics endpoint is protected when configured
- **WHEN** a metrics token is configured and a request arrives without it
- **THEN** the response status is 401 and no metrics are disclosed

#### Scenario: Metrics stay out of the public contract
- **WHEN** the OpenAPI document is generated
- **THEN** it does not contain a path entry for `/metrics`

### Requirement: Optional distributed tracing
The system SHALL support exporting distributed traces over OTLP, covering the HTTP request and its outbound
Elasticsearch and Redis calls. Tracing MUST be driven entirely by configuration: when no OTLP endpoint is
configured the service MUST start and behave exactly as it does with tracing absent, and MUST NOT require a
collector to be reachable for local development, CI or the test suites. A configured exporter MUST NOT fail
a request when the collector is unreachable.

#### Scenario: Tracing is inert by default
- **WHEN** the service starts with no OTLP endpoint configured
- **THEN** it starts normally, serves traffic, and exports no traces

#### Scenario: Traces are exported when configured
- **WHEN** an OTLP endpoint is configured and a search request is handled
- **THEN** a trace is exported containing a span for the HTTP request and child spans for the Elasticsearch
  and Redis calls

#### Scenario: An unreachable collector does not affect the client
- **WHEN** an OTLP endpoint is configured but the collector is unreachable
- **THEN** requests continue to succeed and the failure is confined to the exporter

### Requirement: Observability configuration is validated
Observability settings SHALL be read exclusively from the validated environment configuration, consistent
with the rest of the service. Invalid values MUST fail startup rather than degrade silently, and no
observability component may read `process.env` directly.

#### Scenario: Invalid configuration fails fast
- **WHEN** the service starts with an out-of-range trace sampling ratio
- **THEN** startup fails with a validation error naming the offending variable
