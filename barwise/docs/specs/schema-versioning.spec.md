# Schema Versioning and Migration

Status: Accepted
Tracking: REPO_REVIEW-2026-06.md finding A2

## Problem

Every `.orm.yaml` carries an `orm_version`, but there is no migration
strategy and no clear handling of version mismatches:

- `OrmYamlSerializer.toDocument()` hardcodes `orm_version: "1.0"`.
- The JSON Schema pins `orm_version` with `"const": "1.0"`, so a file
  with any other version is rejected during schema validation with a
  cryptic message: `/orm_version: must be equal to constant`.
- There is no seam to migrate an older document forward, so the moment
  the format needs to change, every existing file in the wild either
  breaks or forces a hand-edit.

The review's point is timing: adding a version check and a migration
hook is cheap now, while `1.0` is the only version. Retrofitting
migration after incompatible files exist is much harder.

## Scope

In scope:

- A single source of truth for the current version
  (`CURRENT_ORM_VERSION`), replacing the hardcoded literal in the
  serializer.
- A clear, actionable error when a document's `orm_version` is present
  but unsupported -- distinguishing "written by a newer barwise" from
  "no migration path".
- A migration seam: an ordered registry of version-to-version
  migrations that `deserialize()` applies to bring an older document up
  to the current version before schema validation. The registry is
  empty today; the mechanism is what matters.

Out of scope:

- Defining an actual `1.1`/`2.0` schema or writing a real migration.
  This PR ships the seam and one synthetic-migration test that proves
  it works.
- Versioning of the project manifest (`.orm-project.yaml`) and context
  mapping (`.map.yaml`) formats. The review calls out `.orm.yaml`
  specifically; the same pattern can extend to those later.

## Approach

### `serialization/schemaVersion.ts` (new, pure)

No dependency on `OrmYamlSerializer` (keeps the module graph acyclic --
the serializer imports this, never the reverse). Exports:

- `CURRENT_ORM_VERSION = "1.0"`.
- `interface OrmVersionMigration { from; to; migrate(doc) }` -- a
  migration upgrades a parsed document from one version to the next and
  sets `orm_version` to its `to`.
- `ORM_VERSION_MIGRATIONS: readonly OrmVersionMigration[]` -- the
  registry, empty for now.
- `planMigration(version, current?, migrations?): MigrationPlan` -- pure.
  Returns the ordered list of migration steps from `version` to
  `current`, or a failure with a reason (`missing` / `unknown` / `newer`
  / `cycle`). Injectable `current`/`migrations` make it unit-testable
  with synthetic versions.
- `applyMigrations(doc, steps): doc` -- pure; folds the steps over the
  document.
- `compareOrmVersions(a, b)` -- pure dotted-numeric comparison, used to
  tell "newer" from "unknown older".

### `OrmYamlSerializer` wiring

- `toDocument()` emits `orm_version: CURRENT_ORM_VERSION`.
- `deserialize()`: after `parse`, if `orm_version` is a string other
  than the current version, run `planMigration`; on failure throw a
  `DeserializationError` with a clear message, otherwise
  `applyMigrations` and continue. Current-version and
  missing/malformed documents keep their existing path (straight to
  schema validation), so behavior only changes for non-current
  versions.

Because migrations bring a document to the current version before
schema validation, the schema always validates the current version and
its `const` stays accurate. When `1.1` lands: bump `CURRENT_ORM_VERSION`
and the schema `const`, and register a `1.0 -> 1.1` migration.

### Public surface

Export `CURRENT_ORM_VERSION` and the `OrmVersionMigration` type from the
core barrel (useful to tools and future connector code). Keep
`planMigration`/`applyMigrations` out of the barrel -- tests import them
from the module directly.

## Verification

- Round-trip serialize/deserialize of a `1.0` model is unchanged.
- `orm_version: "2.0"` (newer) throws a clear "newer barwise" error, not
  the schema `const` message.
- An unknown older version with no migration path throws a clear
  "no migration path" error.
- `planMigration`/`applyMigrations` unit-tested with a synthetic
  `0.9 -> 1.0` migration: the plan orders steps correctly and the
  document is upgraded (proving the seam end to end via `deserialize`
  with an injected registry, or via the pure functions directly).
- Full core suite still passes its coverage thresholds.
