/**
 * Schema versioning for `.orm.yaml` documents.
 *
 * This module is intentionally pure and free of any dependency on the
 * serializer, so the module graph stays acyclic: the serializer imports
 * these helpers, never the reverse. It owns the single source of truth
 * for the current version and the seam for migrating older documents
 * forward before they are validated against the current schema.
 */

import { migrateDiagramReferencesToIds } from "./migrations/diagramReferencesToIds.js";

/**
 * The schema version this build reads and writes. The serializer stamps
 * this onto every document it produces, and the JSON Schema pins its
 * `orm_version` `const` to the same value.
 */
export const CURRENT_ORM_VERSION = "3.0";

/**
 * The version before the current one, which this build still reads: a 2.0
 * file is read by the 2.0 reader (`readDocument20`) straight into the
 * model, against the 2.0 schema frozen when 3.0 landed, and is written as
 * 3.0 when saved (orm-format-3 WS4b). Older versions migrate to it first.
 */
export const LEGACY_ORM_VERSION = "2.0";

/**
 * The first version of the current major. A file from here up to
 * {@link CURRENT_ORM_VERSION} is read by the current reader after the
 * registered minor migrations bring it forward, so a minor bump keeps
 * every earlier file of its major loadable (barwise-jj8). Today it equals
 * the current version, so no minor step exists yet; it moves only with a
 * major bump.
 */
export const CURRENT_MAJOR_FIRST_VERSION = "3.0";

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
 * Registered migrations on the raw document, applied in chain order on
 * load: up to {@link LEGACY_ORM_VERSION} for an older major, and from
 * {@link CURRENT_MAJOR_FIRST_VERSION} to {@link CURRENT_ORM_VERSION} for a
 * minor of the current one. 2.0 to 3.0 is not one of them:
 * placing a 2.0 preferred-identifier flag needs the model (Open decision
 * 8 reads object type kinds, objectifications and roles), so a 2.0 file is
 * read into the model and the model is what 3.0 states. A raw document
 * that needs 3.0 is `writeDocument(readDocument20(doc))`.
 */
export const ORM_VERSION_MIGRATIONS: readonly OrmVersionMigration[] = [
  // 1.0 -> 1.1 added optional constructs (value ranges were de-facto part of
  // 1.0; value-comparison constraints, barwise-5t9.9). The additions are
  // optional, so an older document is already valid under 1.1 -- the
  // migration only restamps the version.
  {
    from: "1.0",
    to: "1.1",
    migrate: (doc) => ({ ...doc, orm_version: "1.1" }),
  },
  // 1.1 -> 2.0 is structural, so it is a major bump (ADR `schema-versioning`): diagram
  // references change from element names to element ids. A 1.x reader
  // would look each id up as a name and silently render the whole model;
  // the version is what makes it refuse instead.
  {
    from: "1.1",
    to: "2.0",
    migrate: migrateDiagramReferencesToIds,
  },
];

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
 * Plan the raw-document migration from `version` to `current`. No default:
 * the loader asks for 2.0 (`LEGACY_ORM_VERSION`), the last version a step
 * on the raw document reaches, because 2.0 to 3.0 goes through the model
 * (orm-format-3 WS4b); a default of either version would answer some
 * caller's question wrongly.
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
  current: string,
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

/** The versions {@link planRead} decides between; injectable for tests. */
export interface ReadVersions {
  readonly current: string;
  readonly currentMajorFirst: string;
  readonly legacy: string;
  readonly migrations: readonly OrmVersionMigration[];
}

const THIS_BUILD: ReadVersions = {
  current: CURRENT_ORM_VERSION,
  currentMajorFirst: CURRENT_MAJOR_FIRST_VERSION,
  legacy: LEGACY_ORM_VERSION,
  migrations: ORM_VERSION_MIGRATIONS,
};

/**
 * How a document stating `version` is read: by the current reader or the
 * previous major's, after which raw-document steps. Refuses a newer
 * version, and a version between the previous major and the current
 * major's first, which no release wrote.
 */
export type ReadPlan =
  | {
    readonly ok: true;
    readonly reader: "current" | "legacy";
    readonly steps: readonly OrmVersionMigration[];
  }
  | { readonly ok: false; readonly reason: "newer" | "unknown" | "cycle"; };

/** Plan the read of a document stating `version`. Pure. */
export function planRead(version: string, versions: ReadVersions = THIS_BUILD): ReadPlan {
  const { current, currentMajorFirst, legacy, migrations } = versions;
  if (compareOrmVersions(version, current) > 0) return { ok: false, reason: "newer" };
  if (compareOrmVersions(version, currentMajorFirst) >= 0) {
    const plan = planMigration(version, current, migrations);
    return plan.ok ? { ok: true, reader: "current", steps: plan.steps } : plan;
  }
  if (compareOrmVersions(version, legacy) > 0) return { ok: false, reason: "unknown" };
  const plan = planMigration(version, legacy, migrations);
  return plan.ok ? { ok: true, reader: "legacy", steps: plan.steps } : plan;
}
