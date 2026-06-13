/**
 * Schema versioning for `.orm.yaml` documents.
 *
 * This module is intentionally pure and free of any dependency on the
 * serializer, so the module graph stays acyclic: the serializer imports
 * these helpers, never the reverse. It owns the single source of truth
 * for the current version and the seam for migrating older documents
 * forward before they are validated against the current schema.
 */

/**
 * The schema version this build reads and writes. The serializer stamps
 * this onto every document it produces, and the JSON Schema pins its
 * `orm_version` `const` to the same value.
 */
export const CURRENT_ORM_VERSION = "1.0";

/**
 * Upgrades a parsed `.orm.yaml` document from one version to the next.
 *
 * A migration MUST set the document's `orm_version` to its `to` value,
 * because migrations run before schema validation and the schema only
 * accepts the current version.
 */
export interface OrmVersionMigration {
  readonly from: string;
  readonly to: string;
  migrate(doc: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Registered migrations, applied in chain order on load. Empty today --
 * `1.0` is the only version. When a new version lands, bump
 * {@link CURRENT_ORM_VERSION} and the schema `const`, and add the
 * version-to-version migration here.
 */
export const ORM_VERSION_MIGRATIONS: readonly OrmVersionMigration[] = [];

/** The ordered migration steps needed to reach the current version. */
export type MigrationPlan =
  | { readonly ok: true; readonly steps: readonly OrmVersionMigration[]; }
  | { readonly ok: false; readonly reason: "newer" | "unknown" | "cycle"; };

/**
 * Compare two dotted-numeric versions (e.g. `"1.0"`, `"1.10"`).
 * Returns a negative number if `a < b`, zero if equal, positive if
 * `a > b`. Non-numeric components fall back to string comparison.
 */
export function compareOrmVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.parseInt(pa[i] ?? "0", 10);
    const y = Number.parseInt(pb[i] ?? "0", 10);
    if (Number.isNaN(x) || Number.isNaN(y)) {
      return a === b ? 0 : a < b ? -1 : 1;
    }
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

/**
 * Plan the migration from `version` to `current`.
 *
 * Pure: `current` and `migrations` are injectable so the planner can be
 * exercised with synthetic versions in tests. Returns the ordered steps
 * (possibly empty when already current), or a failure reason:
 *
 * - `newer`: the document is from a newer build than this one.
 * - `unknown`: no chain of migrations reaches the current version.
 * - `cycle`: the registry loops back to a version already visited.
 */
export function planMigration(
  version: string,
  current: string = CURRENT_ORM_VERSION,
  migrations: readonly OrmVersionMigration[] = ORM_VERSION_MIGRATIONS,
): MigrationPlan {
  if (version === current) return { ok: true, steps: [] };
  if (compareOrmVersions(version, current) > 0) return { ok: false, reason: "newer" };

  const steps: OrmVersionMigration[] = [];
  const seen = new Set<string>();
  let v = version;
  while (v !== current) {
    if (seen.has(v)) return { ok: false, reason: "cycle" };
    seen.add(v);
    const step = migrations.find((m) => m.from === v);
    if (!step) return { ok: false, reason: "unknown" };
    steps.push(step);
    v = step.to;
  }
  return { ok: true, steps };
}

/** Fold an ordered list of migration steps over a parsed document. */
export function applyMigrations(
  doc: Record<string, unknown>,
  steps: readonly OrmVersionMigration[],
): Record<string, unknown> {
  let result = doc;
  for (const step of steps) {
    result = step.migrate(result);
  }
  return result;
}
