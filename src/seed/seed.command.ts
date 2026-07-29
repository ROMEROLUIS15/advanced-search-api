import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { SeedOutcome } from '@application/models/seed-outcome';
import { SeedCatalogUseCase } from '@application/use-cases/seed-catalog.use-case';
import { SeedModule } from './seed.module';
import { loadProducts } from './product-dataset';
import rawDataset from './dataset/products.seed.json';

/**
 * Seed CLI (design D2 / migration plan). Runs in a Nest standalone context:
 * loads and validates the dataset, then provisions the index and bulk-loads it.
 * Idempotent — safe to re-run.
 */
async function runSeed(): Promise<void> {
  const logger = new Logger('Seed');
  const { products, invalid } = loadProducts(rawDataset);
  for (const record of invalid) {
    logger.warn(`Skipping invalid product ${record.id ?? '(no id)'}: ${record.reason}`);
  }

  const context = await NestFactory.createApplicationContext(SeedModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const outcome = await context.get(SeedCatalogUseCase).execute(products);
    const { bulk } = outcome;
    logger.log(describeIndexOutcome(outcome));
    logger.log(`Seed complete: total=${bulk.total} indexed=${bulk.indexed} failed=${bulk.failed}`);
    for (const failure of bulk.failures) {
      logger.warn(`Failed to index ${failure.id}: ${failure.reason}`);
    }
    if (bulk.failed > 0 || invalid.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await context.close();
  }
}

/**
 * The only place an operator learns that a migration happened, so it says which
 * version is being served and which one is kept for a rollback (design D43/D47).
 */
function describeIndexOutcome({ preparation, publication }: SeedOutcome): string {
  if (preparation.action === 'created') {
    return `Index created at version ${preparation.version}.`;
  }
  if (preparation.action === 'unchanged') {
    return `Index definition unchanged; still serving version ${preparation.version}.`;
  }
  if (publication === undefined) {
    return (
      `Definition changed, so version ${preparation.version} was loaded — but NOT published, because ` +
      `documents failed to index. The alias still serves version ${preparation.replacedVersion ?? '?'}.`
    );
  }
  const pruned =
    publication.prunedVersions.length > 0
      ? ` Deleted version(s) ${publication.prunedVersions.join(', ')}.`
      : '';
  return (
    `Definition changed: migrated to version ${publication.version} and moved the alias. ` +
    `Version ${publication.retainedVersion ?? '?'} is retained for rollback.${pruned}`
  );
}

void runSeed();
