# infrastructure

Adapters that implement the application ports: the Elasticsearch client/index/search/suggest
adapters and the Redis cache adapter. Elasticsearch and Redis types stay inside this layer and
never leak across a port.

**Depends on:** `application` (ports + models) and `domain`.
