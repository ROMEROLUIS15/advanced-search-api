# presentation

HTTP edge: controllers, input DTOs (`class-validator`) and response DTOs, plus the global
exception filter. Controllers return response DTOs mapped from domain/application models — a
domain entity is never serialized directly.

**Depends on:** `application` (use-cases via tokens). Never imports `infrastructure` directly.
