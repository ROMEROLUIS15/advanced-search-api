## MODIFIED Requirements

### Requirement: Optional distributed tracing
The system SHALL support exporting distributed traces over OTLP, covering the HTTP request and its outbound
Elasticsearch and Redis calls. Tracing MUST be driven entirely by configuration: when no OTLP endpoint is
configured the service MUST start and behave exactly as it does with tracing absent, and MUST NOT require a
collector to be reachable for local development, CI or the test suites. A configured exporter MUST NOT fail
a request when the collector is unreachable.

Instrumentation SHALL be registered before any instrumented client library is loaded. Because instrumentation
patches modules as they are required, a client loaded earlier stays unpatched and emits no spans while the
service otherwise appears correctly traced. The startup path MUST therefore ensure no application module —
directly or transitively — is loaded before instrumentation is in place, and this ordering MUST be asserted
rather than left to convention.

#### Scenario: Tracing is inert by default
- **WHEN** the service starts with no OTLP endpoint configured
- **THEN** it starts normally, serves traffic, and exports no traces

#### Scenario: Traces are exported when configured
- **WHEN** an OTLP endpoint is configured and a search request is handled
- **THEN** a trace is exported containing a span for the HTTP request and child spans for the Elasticsearch
  and Redis calls

#### Scenario: Every instrumented dependency actually emits spans
- **WHEN** an OTLP endpoint is configured and a request exercises both Elasticsearch and Redis
- **THEN** the exported trace contains a span for each of them, and neither dependency is silently absent

#### Scenario: The startup path cannot load a client before instrumentation
- **WHEN** the entry point is inspected
- **THEN** no application module is loaded before instrumentation is registered, and the application is
  reached only after it

#### Scenario: An unreachable collector does not affect the client
- **WHEN** an OTLP endpoint is configured but the collector is unreachable
- **THEN** requests continue to succeed and the failure is confined to the exporter
