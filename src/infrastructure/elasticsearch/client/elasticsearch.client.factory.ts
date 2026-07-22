import { Client, type ClientOptions } from '@elastic/elasticsearch';
import type { AppConfiguration } from '@config/app-config';

/** DI token for the shared Elasticsearch client. */
export const ELASTICSEARCH_CLIENT = Symbol('ELASTICSEARCH_CLIENT');

/**
 * Builds the Elasticsearch client from configuration, selecting auth (API key vs.
 * basic vs. none) and TLS from env — so the same adapter runs against a local
 * docker container and against Elastic Cloud (design D12).
 */
export function createElasticsearchClient(config: AppConfiguration): Client {
  const { node, apiKey, username, password, tlsRejectUnauthorized } = config.elasticsearch;
  const auth = resolveAuth(apiKey, username, password);
  return new Client({
    node,
    ...(auth ? { auth } : {}),
    tls: { rejectUnauthorized: tlsRejectUnauthorized },
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
