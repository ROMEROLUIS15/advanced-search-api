# telemetry-shipping Specification

## Purpose
Ship the service's own telemetry — metrics and structured logs — from inside the process to external
backends, without a collector agent, without new boundaries being crossed, and without shipping ever
degrading the service. Created by archiving change ship-metrics-and-logs-to-grafana.
## Requirements
### Requirement: Metrics are exported to an external backend
The system SHALL export its own recorded metrics — request counts, request duration, cache hit/miss and
rate-limit fail-over — to an external backend over OTLP, in addition to exposing them at `GET /metrics`.
Export MUST cross the application boundary through the existing metrics port: no call site may reach an
exporter or a metrics library directly. The exporter MUST NOT be registered as the global meter provider, so
that instrumentation libraries do not export histograms nobody declared.

#### Scenario: Declared metrics reach the backend
- **WHEN** metrics export is configured and a search request is served
- **THEN** the request, duration and cache counters recorded for that request are exported to the configured
  backend

#### Scenario: Only declared instruments are exported
- **WHEN** metrics export is configured and requests are served
- **THEN** the exported series are those the service declares, and no series produced by an instrumentation
  library is exported

#### Scenario: The scrape endpoint is unaffected
- **WHEN** metrics export is configured
- **THEN** `GET /metrics` still answers with the same Prometheus text exposition as before, under the same
  token protection

#### Scenario: Recording stays behind the port
- **WHEN** a use-case or adapter records a metric
- **THEN** it does so through the metrics port only, and remains unaware of whether an exporter exists

### Requirement: Application logs are shipped to an external backend
The system SHALL be able to ship its structured log lines to an external log backend while continuing to write
them to standard output. The correlation id MUST be preserved on each shipped line as a queryable field, so a
line can be traced back to its request. Shipping MUST NOT add labels of unbounded cardinality: the correlation
id MUST NOT be used as a stream label.

#### Scenario: Lines reach the backend with their correlation id
- **WHEN** log shipping is configured and a request is handled
- **THEN** the lines that request produced are present in the backend, each carrying the same correlation id as
  a field

#### Scenario: Standard output is preserved
- **WHEN** log shipping is configured
- **THEN** the same JSON lines are still written to standard output, so the platform's own log view keeps
  working

#### Scenario: Stream labels stay bounded
- **WHEN** log shipping is configured and many requests are handled
- **THEN** the number of distinct label combinations sent to the backend does not grow with the number of
  requests

### Requirement: Shipping never degrades the service
Telemetry shipping SHALL be strictly best-effort. An unreachable or failing backend MUST NOT fail a request,
block the request path, or terminate the process. In particular, a failure inside a log transport MUST NOT
surface as an unhandled rejection, which the process safety net would answer by exiting.

#### Scenario: The log backend is unreachable
- **WHEN** log shipping is configured and the backend refuses connections
- **THEN** requests continue to succeed, the process keeps running, and the failure is confined to the
  transport

#### Scenario: The metrics backend is unreachable
- **WHEN** metrics export is configured and the backend refuses connections
- **THEN** requests continue to succeed and `GET /metrics` still answers

#### Scenario: A transport failure does not restart the service
- **WHEN** the log transport raises an error while shipping
- **THEN** the error does not reach the process-level safety net and the process does not exit

### Requirement: Shipping is configuration, and is inert when unconfigured
Each shipping pipeline SHALL be driven entirely by validated configuration, independently of the others. When
a pipeline is not configured the system MUST NOT construct its exporter, transport, worker or timer, and MUST
behave exactly as it does today — local development, CI and the test suites MUST NOT require any backend to be
reachable. Invalid values MUST fail startup rather than degrade silently. The service MUST report at startup
which pipelines are active.

#### Scenario: Nothing is configured
- **WHEN** the service starts with no shipping configured
- **THEN** it starts normally, serves traffic, ships nothing, and constructs no exporter or transport

#### Scenario: One pipeline is configured and the other is not
- **WHEN** only metrics export is configured
- **THEN** metrics are exported and no log transport is constructed

#### Scenario: Invalid shipping configuration fails startup
- **WHEN** the service starts with a malformed shipping endpoint
- **THEN** startup fails with a message naming the offending variable

#### Scenario: Active pipelines are stated at startup
- **WHEN** the service finishes starting
- **THEN** it logs which telemetry pipelines are active and which are not
