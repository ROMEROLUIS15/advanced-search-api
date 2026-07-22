import { Inject, Injectable } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import type { Product } from '@domain/product/product.entity';
import type { BulkResult } from '@application/models/bulk-result';
import type { ProductIndexPort } from '@application/ports/product-index.port';
import { ELASTICSEARCH_CLIENT } from '../client/elasticsearch.client.factory';
import { isAlreadyExistsError } from '../es-errors';
import { productIndexDefinition } from './product-index.mapping';
import { buildBulkOperations, summarizeBulkResponse } from './product-bulk';

const PHYSICAL_INDEX_SUFFIX = '_v1';

/**
 * Elasticsearch adapter for the index lifecycle (design D1/D2). Reads/writes go
 * through a `products` alias pointing at a versioned physical index, enabling
 * zero-downtime reindex. This class only orchestrates; mapping, document mapping
 * and bulk parsing live in dedicated modules.
 */
@Injectable()
export class ProductIndexAdapter implements ProductIndexPort {
  private readonly alias: string;
  private readonly physicalIndex: string;

  constructor(
    @Inject(ELASTICSEARCH_CLIENT) private readonly client: Client,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.alias = config.elasticsearch.index;
    this.physicalIndex = `${this.alias}${PHYSICAL_INDEX_SUFFIX}`;
  }

  async ensureIndex(): Promise<void> {
    if (await this.client.indices.existsAlias({ name: this.alias })) {
      return;
    }
    const { settings, mappings } = productIndexDefinition();
    try {
      await this.client.indices.create({
        index: this.physicalIndex,
        settings,
        mappings,
        aliases: { [this.alias]: {} },
      });
    } catch (error) {
      // A concurrent boot may have created it first — that is a success, not a failure.
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
    }
  }

  async bulkIndex(products: Product[]): Promise<BulkResult> {
    if (products.length === 0) {
      return { total: 0, indexed: 0, failed: 0, failures: [] };
    }
    const operations = buildBulkOperations(products, this.alias);
    const response = await this.client.bulk({ operations });
    return summarizeBulkResponse(response, products.length);
  }

  async refresh(): Promise<void> {
    await this.client.indices.refresh({ index: this.alias });
  }

  async count(): Promise<number> {
    const response = await this.client.count({ index: this.alias });
    return response.count;
  }
}
