import { z } from 'zod';

/**
 * Zod schema for the process environment (design D12).
 *
 * All values arrive as strings, so numeric/boolean fields are coerced here and
 * defaults are applied. Parsing is the single source of truth for the config
 * type (`Env`), and validation runs at boot so the app fails fast.
 */
/**
 * Shortest client key a deployment may carry.
 *
 * Deliberately a length bar and not an entropy estimate: length is unambiguous,
 * and the failure it stops is an operator shipping a placeholder, not an
 * attacker guessing a generated secret (which the SHA-256 comparison and the
 * rate limiter already make hopeless). Low enough that anything produced by
 * `openssl rand`, a UUID or a password manager clears it without thought.
 */
const MIN_API_KEY_LENGTH = 16;

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    // Comma-separated; split into a list by `buildConfig`.
    CORS_ORIGINS: z.string().optional(),

    ELASTICSEARCH_NODE: z.string().url(),
    ELASTICSEARCH_API_KEY: z.string().min(1).optional(),
    ELASTICSEARCH_USERNAME: z.string().min(1).optional(),
    ELASTICSEARCH_PASSWORD: z.string().min(1).optional(),
    ELASTICSEARCH_INDEX: z.string().min(1).default('products'),
    // z.coerce.boolean() treats any non-empty string as true, so parse explicitly.
    ELASTICSEARCH_TLS_REJECT_UNAUTHORIZED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    // Resilience toward Elasticsearch (design D20). A tight request timeout is the
    // main lever for a read API: the client's 30s default holds a connection while
    // a slow ES drains the pool. Retries default to 2 (below the client's 3) —
    // against a single node, more retries amplify load on an ailing cluster.
    ELASTICSEARCH_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(4000),
    ELASTICSEARCH_MAX_RETRIES: z.coerce.number().int().nonnegative().default(2),

    REDIS_URL: z.string().url(),

    CACHE_TTL_SEARCH: z.coerce.number().int().nonnegative().default(300),
    CACHE_TTL_AUTOCOMPLETE: z.coerce.number().int().nonnegative().default(60),

    SEARCH_DEFAULT_PAGE_SIZE: z.coerce.number().int().positive().default(20),
    SEARCH_MAX_PAGE_SIZE: z.coerce.number().int().positive().default(100),
    SEARCH_SUGGEST_MAX_HITS: z.coerce.number().int().nonnegative().default(5),
    SEARCH_MAX_RESULT_WINDOW: z.coerce.number().int().positive().default(10000),

    RELEVANCE_POPULARITY_FACTOR: z.coerce.number().nonnegative().default(1),
    RELEVANCE_RECENCY_SCALE: z.string().min(1).default('90d'),
    RELEVANCE_RECENCY_DECAY: z.coerce.number().gt(0).lt(1).default(0.5),

    // Rate limiting (design D14–D19). Parsed explicitly rather than with
    // z.coerce.boolean(), which treats any non-empty string as true.
    RATE_LIMIT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_SEARCH: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_AUTOCOMPLETE: z.coerce.number().int().positive().default(300),
    RATE_LIMIT_SUGGEST: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_DEFAULT: z.coerce.number().int().positive().default(120),
    // Number of proxy hops to trust, never `true`: believing a client-supplied
    // X-Forwarded-For would let anyone forge an identity past the limiter (D16).
    TRUST_PROXY_HOPS: z.coerce.number().int().nonnegative().default(0),

    // API client authentication (design D30–D34). Unlike everything else here,
    // this defaults to ON: the dangerous failure is a deployment that comes up
    // open because a variable was missed, so an unset value must not mean
    // "unprotected". Turning it off is always deliberate (design D31).
    API_AUTH_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    // Comma-separated; several keys are valid at once so one can be rotated by
    // adding the new one before removing the old. Each must clear
    // MIN_API_KEY_LENGTH — enforced in a refinement below, where the
    // API_AUTH_ENABLED flag is also in scope.
    API_KEYS: z.string().optional(),

    // Observability (design D21–D25). Every switch here is optional and inert by
    // default, so a deployment without any of it behaves exactly as before.
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
    // Human-readable output for local work; JSON everywhere a machine reads it.
    LOG_PRETTY: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    METRICS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    // Optional for local work. The production refinement below requires it
    // whenever metrics are enabled because the endpoint exposes operational data.
    METRICS_TOKEN: z.string().trim().min(1).optional(),
    // Unset means no OTel SDK is ever started: no exporter, no spans, no overhead
    // (design D25). This is what keeps CI and the e2e suites collector-free.
    OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
    // Comma-separated `key=value` pairs, the OTLP convention for auth headers.
    OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
    OTEL_SERVICE_NAME: z.string().min(1).default('advanced-search-api'),
    OTEL_TRACES_SAMPLER_RATIO: z.coerce.number().min(0).max(1).default(0.1),

    // Telemetry shipping. Each pipeline is independent and off unless asked for:
    // an OTLP endpoint set for *tracing* must never start a metrics pipeline as a
    // side effect, which is the exact accident this codebase already had once.
    OTEL_METRICS_EXPORT_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    // How often the reader flushes. The interval is the cost lever on a
    // per-series-per-scrape backend: halving it doubles the samples stored.
    OTEL_METRIC_EXPORT_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
    // Unset means no log transport is constructed: no worker thread, no batching
    // timer, no network. What keeps CI and the e2e suites backend-free.
    LOKI_URL: z.string().url().optional(),
    // Grafana Cloud authenticates Loki with basic auth (numeric user id +
    // token). Both optional so a local, unauthenticated Loki also works.
    LOKI_USERNAME: z.string().min(1).optional(),
    LOKI_PASSWORD: z.string().min(1).optional(),
  })
  .refine((env) => !env.ELASTICSEARCH_USERNAME || Boolean(env.ELASTICSEARCH_PASSWORD), {
    message: 'ELASTICSEARCH_PASSWORD is required when ELASTICSEARCH_USERNAME is set',
    path: ['ELASTICSEARCH_PASSWORD'],
  })
  .refine((env) => env.SEARCH_MAX_PAGE_SIZE >= env.SEARCH_DEFAULT_PAGE_SIZE, {
    message: 'SEARCH_MAX_PAGE_SIZE must be >= SEARCH_DEFAULT_PAGE_SIZE',
    path: ['SEARCH_MAX_PAGE_SIZE'],
  })
  // Refuse to boot rather than come up serving everyone: a service that cannot
  // authenticate anybody is not a service with an open door (design D31).
  .refine((env) => !env.API_AUTH_ENABLED || parseKeys(env.API_KEYS).length > 0, {
    message:
      'API_KEYS must list at least one key when API_AUTH_ENABLED is true ' +
      '(set API_AUTH_ENABLED=false explicitly for local development)',
    path: ['API_KEYS'],
  })
  // Having *a* key was the only bar until now, so `API_KEYS=x` validated
  // cleanly and shipped a one-character credential. Checked per key rather than
  // on the raw string, or one strong key would excuse a weak sibling during a
  // rotation — exactly the window where a placeholder gets added in a hurry.
  .refine(
    (env) =>
      !env.API_AUTH_ENABLED ||
      parseKeys(env.API_KEYS).every((key) => key.length >= MIN_API_KEY_LENGTH),
    {
      message:
        `every key in API_KEYS must be at least ${MIN_API_KEY_LENGTH} characters; ` +
        'the values are never echoed, so check them on the deployment host',
      path: ['API_KEYS'],
    },
  )
  // `/metrics` has its own credential and is exempt from the application API
  // key. Refuse a production boot that would leave real measurements public.
  .refine(
    (env) =>
      env.NODE_ENV !== 'production' || !env.METRICS_ENABLED || env.METRICS_TOKEN !== undefined,
    {
      message: 'METRICS_TOKEN is required when metrics are enabled in production',
      path: ['METRICS_TOKEN'],
    },
  )
  // Asking for export without somewhere to export to is a typo, not a config:
  // it would start a reader that fails every flush, silently.
  .refine(
    (env) => !env.OTEL_METRICS_EXPORT_ENABLED || env.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined,
    {
      message:
        'OTEL_EXPORTER_OTLP_ENDPOINT is required when OTEL_METRICS_EXPORT_ENABLED is true ' +
        '(metrics and traces share the gateway; the SDK appends /v1/metrics)',
      path: ['OTEL_EXPORTER_OTLP_ENDPOINT'],
    },
  )
  // Half a credential authenticates nothing, and Loki answers 401 to every
  // batch — a failure that is invisible from here because shipping is
  // best-effort by design.
  .refine((env) => (env.LOKI_USERNAME === undefined) === (env.LOKI_PASSWORD === undefined), {
    message: 'LOKI_USERNAME and LOKI_PASSWORD must be set together, or neither',
    path: ['LOKI_PASSWORD'],
  })
  .refine((env) => env.LOKI_URL !== undefined || env.LOKI_USERNAME === undefined, {
    message: 'LOKI_USERNAME/LOKI_PASSWORD are set but LOKI_URL is not, so nothing is shipped',
    path: ['LOKI_URL'],
  });

/** The same shape `app-config` maps this variable into: trimmed, empties dropped. */
function parseKeys(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

export type Env = z.infer<typeof envSchema>;

/** Validates raw env, throwing a readable aggregated error on failure (fail-fast). */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
