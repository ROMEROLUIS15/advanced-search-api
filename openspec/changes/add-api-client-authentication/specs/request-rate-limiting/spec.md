## MODIFIED Requirements

### Requirement: Client identification behind a proxy
The system SHALL identify a client by its **API key when the request carries one**, and by its source address
otherwise — resolved through a configurable number of trusted proxy hops. When no proxy hop is trusted, a
client-supplied forwarding header MUST NOT influence identification, so a client cannot evade or impersonate a
budget by forging it. The key itself MUST NOT be used as the storage key; a derived, non-reversible identifier
is used instead, so a credential never reaches the counter store.

#### Scenario: Distinct clients hold distinct budgets behind a trusted proxy
- **WHEN** the service runs behind one trusted proxy hop
- **AND** two clients with different forwarded addresses issue requests
- **THEN** each client consumes only its own budget
- **AND** one client exhausting its budget does not cause the other to be rejected

#### Scenario: A forged forwarding header is ignored when no proxy is trusted
- **WHEN** no proxy hop is trusted
- **AND** a client sends a forwarding header claiming a different address on every request
- **THEN** all those requests count against the same budget

#### Scenario: Two consumers sharing one address
- **WHEN** two clients presenting different API keys call from the same network address
- **THEN** each consumes its own budget, rather than sharing the address's

#### Scenario: The credential does not reach the store
- **WHEN** a request identified by an API key is counted
- **THEN** the counter is keyed by a derived identifier, and the key itself appears nowhere in the store
