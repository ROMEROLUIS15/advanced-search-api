# application

Use-cases and the ports they depend on. Ports are `interface` + `Symbol` token pairs; use-cases
depend only on tokens, never on infrastructure classes. Holds the input/result models
(`SearchCriteria`, `SearchOutcome`, `ProductSummary`, `Facets`, …) exchanged across the boundary.

**Depends on:** `domain` only.
