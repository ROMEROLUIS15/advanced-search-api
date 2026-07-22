import { z } from 'zod';

/**
 * Zod schema for the process environment (design D12).
 *
 * All values arrive as strings, so numeric/boolean fields are coerced here and
 * defaults are applied. Parsing is the single source of truth for the config
 * type (`Env`), and validation runs at boot so the app fails fast.
 */
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
  })
  .refine((env) => !env.ELASTICSEARCH_USERNAME || Boolean(env.ELASTICSEARCH_PASSWORD), {
    message: 'ELASTICSEARCH_PASSWORD is required when ELASTICSEARCH_USERNAME is set',
    path: ['ELASTICSEARCH_PASSWORD'],
  })
  .refine((env) => env.SEARCH_MAX_PAGE_SIZE >= env.SEARCH_DEFAULT_PAGE_SIZE, {
    message: 'SEARCH_MAX_PAGE_SIZE must be >= SEARCH_DEFAULT_PAGE_SIZE',
    path: ['SEARCH_MAX_PAGE_SIZE'],
  });

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
