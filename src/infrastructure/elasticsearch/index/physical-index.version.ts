import { IndexMigrationError } from './index-migration.error';

const PHYSICAL_INDEX_PATTERN = /^(?<alias>.+)_v(?<version>\d+)$/;

/** `products` + 2 ⇒ `products_v2`. The one place the physical name is spelled. */
export function physicalIndexName(alias: string, version: number): string {
  return `${alias}_v${version}`;
}

/**
 * The version of the index an alias currently points at (design D44). Read from
 * the live cluster rather than from configuration, which is what keeps the
 * deployed state and the code from disagreeing about which version is current.
 *
 * An index that does not follow the convention is an error rather than a guess:
 * inventing a next version from `products_hand_made` would create a second index
 * and flip the alias onto it, silently discarding whatever someone did by hand.
 */
export function parsePhysicalIndexVersion(alias: string, physicalIndex: string): number {
  const match = PHYSICAL_INDEX_PATTERN.exec(physicalIndex);
  const version = Number(match?.groups?.version);
  if (match?.groups?.alias !== alias || !Number.isInteger(version) || version < 1) {
    throw new IndexMigrationError(
      `Alias "${alias}" points at "${physicalIndex}", which is not a "${alias}_v<n>" index. ` +
        'Refusing to migrate: point the alias at a conventionally named index first.',
    );
  }
  return version;
}

/**
 * The same parse, returning `undefined` instead of throwing. Used when deciding
 * what to *delete*: an index whose name cannot be read is one nobody understands,
 * and the safe response to that is to leave it alone, not to raise.
 */
export function tryParsePhysicalIndexVersion(
  alias: string,
  physicalIndex: string,
): number | undefined {
  try {
    return parsePhysicalIndexVersion(alias, physicalIndex);
  } catch {
    return undefined;
  }
}

/** The version to create next; 1 when nothing is provisioned yet (design D44). */
export function nextPhysicalVersion(currentVersion: number | undefined): number {
  return currentVersion === undefined ? 1 : currentVersion + 1;
}
