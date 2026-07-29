import { Inject, Injectable } from '@nestjs/common';
import { Client, type estypes } from '@elastic/elasticsearch';
import { APP_CONFIG, type AppConfiguration } from '@config/app-config';
import type { Product } from '@domain/product/product.entity';
import type { BulkResult } from '@application/models/bulk-result';
import type { IndexPreparation, IndexPublication } from '@application/models/index-migration';
import type { ProductIndexPort } from '@application/ports/product-index.port';
import { ELASTICSEARCH_CLIENT } from '../client/elasticsearch.client.factory';
import { isAlreadyExistsError, isIndexNotFoundError } from '../es-errors';
import { productIndexDefinition } from './product-index.mapping';
import { buildBulkOperations, summarizeBulkResponse } from './product-bulk';
import {
  fingerprintDefinition,
  readFingerprint,
  withFingerprint,
  type IndexDefinition,
} from './index-definition.fingerprint';
import {
  nextPhysicalVersion,
  parsePhysicalIndexVersion,
  physicalIndexName,
  tryParsePhysicalIndexVersion,
} from './physical-index.version';
import { IndexMigrationError } from './index-migration.error';

interface LiveIndex {
  version: number;
  fingerprint: string | undefined;
}

interface PendingVersion {
  version: number;
  replacedVersion: number;
}

/**
 * Elasticsearch adapter for the index lifecycle (design D1/D2/D43-D47). Reads and
 * writes go through a `products` alias pointing at a versioned physical index. When
 * the definition in the code stops matching the one recorded on the live index, a
 * new version is provisioned, loaded, and published with an atomic alias flip.
 *
 * The pending version is adapter state rather than a parameter on the port: the
 * alternative leaks a physical index name through the application layer, and this
 * object's whole life is one run of the seed's standalone context.
 */
@Injectable()
export class ProductIndexAdapter implements ProductIndexPort {
  private readonly alias: string;
  private servedVersion: number | undefined;
  private pending: PendingVersion | undefined;

  constructor(
    @Inject(ELASTICSEARCH_CLIENT) private readonly client: Client,
    @Inject(APP_CONFIG) config: AppConfiguration,
  ) {
    this.alias = config.elasticsearch.index;
  }

  async ensureIndex(): Promise<IndexPreparation> {
    const base = productIndexDefinition();
    const definition = withFingerprint(base);
    const live = await this.readLiveIndex();

    if (live === undefined) {
      await this.createInitialIndex(definition);
      this.servedVersion = 1;
      this.pending = undefined;
      return { action: 'created', version: 1 };
    }

    this.servedVersion = live.version;
    if (live.fingerprint === fingerprintDefinition(base)) {
      this.pending = undefined;
      return { action: 'unchanged', version: live.version };
    }

    const version = nextPhysicalVersion(live.version);
    await this.createPendingIndex(version, definition);
    this.pending = { version, replacedVersion: live.version };
    return { action: 'migrating', version, replacedVersion: live.version };
  }

  async bulkIndex(products: Product[]): Promise<BulkResult> {
    if (products.length === 0) {
      return { total: 0, indexed: 0, failed: 0, failures: [] };
    }
    const operations = buildBulkOperations(products, this.writeTarget());
    const response = await this.client.bulk({ operations });
    return summarizeBulkResponse(response, products.length);
  }

  async refresh(): Promise<void> {
    await this.client.indices.refresh({ index: this.writeTarget() });
  }

  async count(): Promise<number> {
    const response = await this.client.count({ index: this.writeTarget() });
    return response.count;
  }

  async publishIndex(): Promise<IndexPublication> {
    const pending = this.pending;
    if (pending === undefined) {
      if (this.servedVersion === undefined) {
        throw new IndexMigrationError('publishIndex() called before ensureIndex().');
      }
      return { published: false, version: this.servedVersion, prunedVersions: [] };
    }

    await this.client.indices.updateAliases({
      actions: [
        {
          remove: {
            index: physicalIndexName(this.alias, pending.replacedVersion),
            alias: this.alias,
          },
        },
        { add: { index: physicalIndexName(this.alias, pending.version), alias: this.alias } },
      ],
    });

    const prunedVersions = await this.pruneOlderThan(pending.replacedVersion);
    this.servedVersion = pending.version;
    this.pending = undefined;
    return {
      published: true,
      version: pending.version,
      retainedVersion: pending.replacedVersion,
      prunedVersions,
    };
  }

  /** Writes land in the pending version while a migration is in flight (design D45). */
  private writeTarget(): string {
    return this.pending === undefined
      ? this.alias
      : physicalIndexName(this.alias, this.pending.version);
  }

  /**
   * One call yields both halves of the live state: `getMapping` by alias answers
   * keyed by the physical index name (verified on 8.17.0 and Serverless 9.6.0).
   */
  private async readLiveIndex(): Promise<LiveIndex | undefined> {
    let response: estypes.IndicesGetMappingResponse;
    try {
      response = await this.client.indices.getMapping({ index: this.alias });
    } catch (error) {
      if (isIndexNotFoundError(error)) {
        return undefined;
      }
      throw error;
    }

    const entries = Object.entries(response);
    if (entries.length === 0) {
      return undefined;
    }
    if (entries.length > 1) {
      throw new IndexMigrationError(
        `Alias "${this.alias}" points at ${entries.length} indices (${entries
          .map(([name]) => name)
          .join(', ')}). Refusing to migrate an ambiguous alias.`,
      );
    }

    const [name, record] = entries[0];
    return {
      version: parsePhysicalIndexVersion(this.alias, name),
      fingerprint: readFingerprint(record.mappings),
    };
  }

  /**
   * First provisioning: the alias is attached inline, so it exists the instant the
   * index does. A concurrent creator that got there first is tolerated — but if it
   * left a physical index without an alias, that is repaired rather than reported
   * as success.
   */
  private async createInitialIndex(definition: IndexDefinition): Promise<void> {
    const index = physicalIndexName(this.alias, 1);
    try {
      await this.client.indices.create({
        index,
        settings: definition.settings,
        mappings: definition.mappings,
        aliases: { [this.alias]: {} },
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      if (!(await this.client.indices.existsAlias({ name: this.alias }))) {
        await this.client.indices.putAlias({ index, name: this.alias });
      }
    }
  }

  /**
   * Migration target: created *without* the alias, which stays on the version still
   * serving reads until `publishIndex` flips it. An existing index here means
   * another migration is already in flight; loading into it would interleave two
   * seeds in one index, so this fails loudly instead.
   */
  private async createPendingIndex(version: number, definition: IndexDefinition): Promise<void> {
    const index = physicalIndexName(this.alias, version);
    try {
      await this.client.indices.create({
        index,
        settings: definition.settings,
        mappings: definition.mappings,
      });
    } catch (error) {
      if (!isAlreadyExistsError(error)) {
        throw error;
      }
      throw new IndexMigrationError(
        `Index "${index}" already exists, so another migration is in flight. Re-run once it finishes.`,
      );
    }
  }

  /** Keeps exactly one version behind the alias for rollback (design D47). */
  private async pruneOlderThan(retainedVersion: number): Promise<number[]> {
    const response = await this.client.indices.get({ index: `${this.alias}_v*` });
    const stale = Object.keys(response)
      .map((name) => ({ name, version: tryParsePhysicalIndexVersion(this.alias, name) }))
      .filter((index): index is { name: string; version: number } => index.version !== undefined)
      .filter((index) => index.version < retainedVersion);

    for (const index of stale) {
      await this.client.indices.delete({ index: index.name });
    }
    return stale.map((index) => index.version).sort((a, b) => a - b);
  }
}
