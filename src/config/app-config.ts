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

/** Logging, metrics and tracing (design D21–D25). Everything here is inert unless switched on. */
export interface ObservabilityConfig {
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  logPretty: boolean;
  metricsEnabled: boolean;
  /** When set, `/metrics` requires this bearer token. */
  metricsToken?: string;
  /** Absent means tracing is never started — no SDK, no exporter (design D25). */
  otlpEndpoint?: string;
  otlpHeaders: Record<string, string>;
  serviceName: string;
  tracesSamplerRatio: number;
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
  observability: ObservabilityConfig;
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
    observability: {
      logLevel: env.LOG_LEVEL,
      logPretty: env.LOG_PRETTY,
      metricsEnabled: env.METRICS_ENABLED,
      metricsToken: env.METRICS_TOKEN,
      otlpEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT,
      otlpHeaders: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
      serviceName: env.OTEL_SERVICE_NAME,
      tracesSamplerRatio: env.OTEL_TRACES_SAMPLER_RATIO,
    },
  };
}

/**
 * Parses the OTLP `key=value,key=value` header convention. A pair without `=` is
 * skipped rather than producing an empty header name, and only the first `=` is
 * treated as the separator so a base64 credential keeps its padding.
 *
 * Values are **percent-decoded**, as the OpenTelemetry environment-variable
 * specification requires. This is not academic: Grafana Cloud hands you
 * `Authorization=Basic%20<base64>`, and sending that literally is a 401 —
 * measured against their OTLP gateway, which answers 200 for the decoded form
 * and 401 for the encoded one.
 */
function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  if (!raw) {
    return {};
  }
  const headers: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }
    const key = percentDecode(pair.slice(0, separator).trim());
    const value = percentDecode(pair.slice(separator + 1).trim());
    if (key.length > 0 && value.length > 0) {
      headers[key] = value;
    }
  }
  return headers;
}

/** A malformed escape is kept as-is rather than failing the whole boot over one header. */
function percentDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
