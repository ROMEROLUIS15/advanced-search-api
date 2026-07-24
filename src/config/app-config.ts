import type { Env } from './env.schema';

/** DI token for the typed, namespaced application configuration. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export interface AppRuntimeConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  corsOrigins: string[];
}

export interface ElasticsearchConfig {
  node: string;
  apiKey?: string;
  username?: string;
  password?: string;
  index: string;
  tlsRejectUnauthorized: boolean;
  /** Per-request timeout in ms and client retry budget (design D20). */
  requestTimeoutMs: number;
  maxRetries: number;
}

export interface RedisConfig {
  url: string;
}

export interface CacheConfig {
  searchTtlSeconds: number;
  autocompleteTtlSeconds: number;
}

export interface SearchConfig {
  defaultPageSize: number;
  maxPageSize: number;
  suggestMaxHits: number;
  maxResultWindow: number;
}

export interface RelevanceConfig {
  popularityFactor: number;
  recencyScale: string;
  recencyDecay: number;
}

/** Per-endpoint request budgets and how a client is identified (design D14–D19). */
export interface RateLimitConfig {
  enabled: boolean;
  windowSeconds: number;
  search: number;
  autocomplete: number;
  suggest: number;
  default: number;
  /** Proxy hops Express may trust when resolving the client address. */
  trustProxyHops: number;
}

/** Namespaced configuration consumed across the app; adapters read this, never `process.env`. */
export interface AppConfiguration {
  app: AppRuntimeConfig;
  elasticsearch: ElasticsearchConfig;
  redis: RedisConfig;
  cache: CacheConfig;
  search: SearchConfig;
  relevance: RelevanceConfig;
  rateLimit: RateLimitConfig;
}

/** Maps flat validated env into the namespaced configuration object. */
export function buildConfig(env: Env): AppConfiguration {
  return {
    app: {
      nodeEnv: env.NODE_ENV,
      port: env.PORT,
      corsOrigins: parseOrigins(env.CORS_ORIGINS),
    },
    elasticsearch: {
      node: env.ELASTICSEARCH_NODE,
      apiKey: env.ELASTICSEARCH_API_KEY,
      username: env.ELASTICSEARCH_USERNAME,
      password: env.ELASTICSEARCH_PASSWORD,
      index: env.ELASTICSEARCH_INDEX,
      tlsRejectUnauthorized: env.ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED,
      requestTimeoutMs: env.ELASTICSEARCH_REQUEST_TIMEOUT_MS,
      maxRetries: env.ELASTICSEARCH_MAX_RETRIES,
    },
    redis: { url: env.REDIS_URL },
    cache: {
      searchTtlSeconds: env.CACHE_TTL_SEARCH,
      autocompleteTtlSeconds: env.CACHE_TTL_AUTOCOMPLETE,
    },
    search: {
      defaultPageSize: env.SEARCH_DEFAULT_PAGE_SIZE,
      maxPageSize: env.SEARCH_MAX_PAGE_SIZE,
      suggestMaxHits: env.SEARCH_SUGGEST_MAX_HITS,
      maxResultWindow: env.SEARCH_MAX_RESULT_WINDOW,
    },
    relevance: {
      popularityFactor: env.RELEVANCE_POPULARITY_FACTOR,
      recencyScale: env.RELEVANCE_RECENCY_SCALE,
      recencyDecay: env.RELEVANCE_RECENCY_DECAY,
    },
    rateLimit: {
      enabled: env.RATE_LIMIT_ENABLED,
      windowSeconds: env.RATE_LIMIT_WINDOW_SECONDS,
      search: env.RATE_LIMIT_SEARCH,
      autocomplete: env.RATE_LIMIT_AUTOCOMPLETE,
      suggest: env.RATE_LIMIT_SUGGEST,
      default: env.RATE_LIMIT_DEFAULT,
      trustProxyHops: env.TRUST_PROXY_HOPS,
    },
  };
}

function parseOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
