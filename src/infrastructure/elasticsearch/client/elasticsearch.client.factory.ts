import { Client, type ClientOptions } from '@elastic/elasticsearch';
import type { AppConfiguration } from '@config/app-config';

/** DI token for the shared Elasticsearch client. */
export const ELASTICSEARCH_CLIENT = Symbol('ELASTICSEARCH_CLIENT');

/**
 * Builds the Elasticsearch client from configuration, selecting auth (API key vs.
 * basic vs. none) and TLS from env — so the same adapter runs against a local
 * docker container and against Elastic Cloud (design D12).
 *
 * An explicit `requestTimeout` and `maxRetries` override the client's 30s / 3
 * defaults (design D20): a tight timeout keeps a slow Elasticsearch from draining
 * the connection pool, and a smaller retry budget avoids amplifying load on an
 * ailing single-node cluster. Both are env-tunable.
 */
export function createElasticsearchClient(config: AppConfiguration): Client {
  const { node, apiKey, username, password, tlsRejectUnauthorized, requestTimeoutMs, maxRetries } =
    config.elasticsearch;
  const auth = resolveAuth(apiKey, username, password);
  return new Client({
    node,
    ...(auth ? { auth } : {}),
    tls: { rejectUnauthorized: tlsRejectUnauthorized },
    requestTimeout: requestTimeoutMs,
    maxRetries,
  });
}

function resolveAuth(
  apiKey: string | undefined,
  username: string | undefined,
  password: string | undefined,
): ClientOptions['auth'] {
  if (apiKey) {
    return { apiKey };
  }
  if (username && password) {
    return { username, password };
  }
  // Local Elasticsearch with security disabled — no credentials.
  return undefined;
}
