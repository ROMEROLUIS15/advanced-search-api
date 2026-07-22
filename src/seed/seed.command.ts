import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
    const result = await context.get(SeedCatalogUseCase).execute(products);
    logger.log(
      `Seed complete: total=${result.total} indexed=${result.indexed} failed=${result.failed}`,
    );
    for (const failure of result.failures) {
      logger.warn(`Failed to index ${failure.id}: ${failure.reason}`);
    }
    if (result.failed > 0 || invalid.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await context.close();
  }
}

void runSeed();
