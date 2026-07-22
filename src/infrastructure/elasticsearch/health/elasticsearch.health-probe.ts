import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { errorMessage } from '@shared/error-message';
import type { DependencyHealth, HealthProbePort } from '@application/ports/health-probe.port';
import { ELASTICSEARCH_CLIENT } from '../client/elasticsearch.client.factory';

/** Critical probe: Elasticsearch being down drives an overall 503. */
@Injectable()
export class ElasticsearchHealthProbe implements HealthProbePort {
  readonly name = 'elasticsearch';
  readonly critical = true;

  constructor(@Inject(ELASTICSEARCH_CLIENT) private readonly client: Client) {}

  async ping(): Promise<DependencyHealth> {
    try {
      await this.client.ping();
      return { name: this.name, status: 'up', critical: this.critical };
    } catch (error) {
      return {
        name: this.name,
        status: 'down',
        critical: this.critical,
        detail: errorMessage(error),
      };
    }
  }
}
