# config

Environment configuration: the Zod validation schema (fail-fast at boot) and typed, namespaced
config accessors (`es`, `redis`, `cache`, `search`, `relevance`). Adapters read config from here,
never from `process.env` directly. Implemented in group 2 (design D12).
