/**
 * SQL pattern merge for the dbt importer (sql-dialect-capability spec,
 * WS1).
 *
 * dbt model `.sql` files carry the joins, WHERE guards, and CASE
 * branches that encode rules on warehouses without enforced
 * constraints. This module merges the patterns mined from that SQL
 * into the same stream the schema-YAML tests produce: constraints on
 * the existing fact types, plus report entries for everything the SQL
 * suggests but the mapper will not silently assert.
 *
 * Merge rules (deterministic and conservative -- a mart's WHERE filter
 * is not always a domain rule, so every merged constraint is surfaced
 * as a "warning" report entry, the severity the YAML path uses for
 * applied inference):
 *
 *   - `col IS NOT NULL` guards and NOT NULL DDL -> mandatory role
 *     constraint (mirrors the not_null test)
 *   - `col IN (...)` in WHERE/CHECK -> value constraint (mirrors
 *     accepted_values)
 *   - CASE branches enumerating >= 2 equality values on one column ->
 *     value constraint
 *   - UNIQUE DDL on a single column -> internal uniqueness (mirrors
 *     the unique test)
 *   - JOINs / FOREIGN KEYs between two mapped entities with no
 *     declared relationship -> "gap" report entry only (direction and
 *     cardinality are unknowable from the join alone)
 *
 * Constraints already present (from YAML tests or an earlier pattern)
 * are never duplicated.
 */

import type { Constraint, FactType, OrmModel } from "@barwise/core";
import type { SqlPatternContext } from "@barwise/core/sql";
import type { ReportBuilder } from "../DbtImportReport.js";
import { toPascalCase } from "./naming.js";

/** Patterns mined from one dbt model's compiled SQL. */
export interface MinedSqlFile {
  /** The dbt model name (SQL file basename without extension). */
  readonly modelName: string;
  /** Path of the SQL file the patterns came from (for provenance). */
  readonly sourcePath: string;
  /** Patterns extracted by the cascade (sqlglot or regex tier). */
  readonly patterns: readonly SqlPatternContext[];
}

/** What the merge did, for the importer's summary warning. */
export interface SqlMergeStats {
  /** Constraints added to the model. */
  readonly constraintsAdded: number;
  /** Report entries emitted (including the added-constraint warnings). */
  readonly entriesReported: number;
}

/**
 * Merge mined SQL patterns into the model produced by the schema-YAML
 * mapping. Mutates `model` (adds constraints to existing fact types)
 * and `report`.
 */
export function mergeSqlPatterns(
  model: OrmModel,
  files: readonly MinedSqlFile[],
  report: ReportBuilder,
): SqlMergeStats {
  let added = 0;
  let reported = 0;
  const reportedPairs = new Set<string>();

  for (const file of files) {
    const entityName = toPascalCase(file.modelName);
    const entity = model.getObjectTypeByName(entityName);

    for (const p of file.patterns) {
      if (entity) {
        added += mergeColumnPatterns(model, entity.id, entityName, file, p, report, () => {
          reported += 1;
        });
      }
      reported += mergeRelationshipPattern(model, file, p, report, reportedPairs);
    }
  }

  return { constraintsAdded: added, entriesReported: reported };
}

// ---------------------------------------------------------------------------
// Column-level patterns -> constraints
// ---------------------------------------------------------------------------

function mergeColumnPatterns(
  model: OrmModel,
  entityId: string,
  entityName: string,
  file: MinedSqlFile,
  p: SqlPatternContext,
  report: ReportBuilder,
  onReport: () => void,
): number {
  let added = 0;

  const apply = (
    column: string,
    build: (entityRoleId: string, valueRoleId: string, ft: FactType) => Constraint | undefined,
    message: (ft: FactType) => string,
  ): void => {
    const ft = factTypeForColumn(model, entityId, entityName, column);
    if (!ft) return;
    const roles = rolesOf(ft, entityId);
    if (!roles) return;
    const constraint = build(roles.entityRoleId, roles.valueRoleId, ft);
    if (!constraint) return;
    ft.addConstraint(constraint);
    added += 1;
    report.warning("constraint", file.modelName, `${message(ft)} ${provenance(file, p)}`, column);
    onReport();
  };

  const applyValueConstraint = (column: string, values: readonly string[]): void => {
    apply(
      column,
      (_entityRoleId, valueRoleId, ft) =>
        hasValueConstraint(ft, valueRoleId)
          ? undefined
          : { type: "value_constraint", roleId: valueRoleId, values: [...values] },
      (ft) =>
        `SQL value enumeration on "${column}" (${
          values.join(", ")
        }) -> value constraint on "${ft.name}".`,
    );
  };

  switch (p.kind) {
    case "where":
    case "not_null": {
      for (const column of notNullColumns(p)) {
        apply(
          column,
          (entityRoleId, _valueRoleId, ft) =>
            hasMandatory(ft, entityRoleId)
              ? undefined
              : { type: "mandatory", roleId: entityRoleId },
          (ft) => `SQL NOT NULL guard on "${column}" -> mandatory constraint on "${ft.name}".`,
        );
      }
      if (p.kind === "not_null") break;
      // WHERE clauses can also carry IN enumerations; extract them the
      // same way as CHECK below.
      for (const { column, values } of inListValues(p.sourceText)) {
        applyValueConstraint(column, values);
      }
      break;
    }
    case "check": {
      for (const { column, values } of inListValues(p.sourceText)) {
        applyValueConstraint(column, values);
      }
      break;
    }
    case "case": {
      for (const { column, values } of caseBranchValues(p)) {
        if (values.length < 2) continue;
        applyValueConstraint(column, values);
      }
      break;
    }
    case "unique": {
      if (p.columns?.length === 1) {
        const column = p.columns[0]!;
        apply(
          column,
          (_entityRoleId, valueRoleId, ft) =>
            hasUniqueness(ft, valueRoleId)
              ? undefined
              : { type: "internal_uniqueness", roleIds: [valueRoleId] },
          (ft) => `SQL UNIQUE on "${column}" -> uniqueness constraint on "${ft.name}".`,
        );
      }
      break;
    }
    default:
      break;
  }

  return added;
}

// ---------------------------------------------------------------------------
// Relationship patterns -> report entries
// ---------------------------------------------------------------------------

function mergeRelationshipPattern(
  model: OrmModel,
  file: MinedSqlFile,
  p: SqlPatternContext,
  report: ReportBuilder,
  reportedPairs: Set<string>,
): number {
  if (p.kind !== "join" && p.kind !== "foreign_key") return 0;

  // The near side of a join or FK in a dbt model's SQL is the model
  // itself; the pattern's tables name the far side (the regex tier may
  // also append aliases from the ON condition, so take the first table
  // that resolves to a different mapped entity).
  const source = model.getObjectTypeByName(toPascalCase(file.modelName));
  if (!source) return 0;
  const target = (p.tables ?? [])
    .map((t) => model.getObjectTypeByName(toPascalCase(t)))
    .find((ot) => ot !== undefined && ot.id !== source.id);
  if (!target) return 0;
  if (haveRelationship(model, source.id, target.id)) return 0;

  const pairKey = [source.id, target.id].sort().join("::");
  if (reportedPairs.has(pairKey)) return 0;
  reportedPairs.add(pairKey);

  report.gap(
    "relationship",
    file.modelName,
    `SQL ${p.kind === "join" ? "JOIN" : "FOREIGN KEY"} relates "${source.name}" and `
      + `"${target.name}" but no relationship test declares it -- consider a `
      + `relationships test in the schema YAML. ${provenance(file, p)}`,
  );
  return 1;
}

// ---------------------------------------------------------------------------
// Model lookups
// ---------------------------------------------------------------------------

/**
 * Find the `Entity has Value` fact type the YAML mapping created for a
 * column of this dbt model.
 */
function factTypeForColumn(
  model: OrmModel,
  entityId: string,
  entityName: string,
  column: string,
): FactType | undefined {
  const bare = column.includes(".") ? column.slice(column.lastIndexOf(".") + 1) : column;
  const ft = model.factTypes.find((f) => f.name === `${entityName} has ${toPascalCase(bare)}`);
  if (!ft || ft.arity !== 2) return undefined;
  // Guard against a same-named fact type that does not involve this entity.
  return ft.roles.some((r) => r.playerId === entityId) ? ft : undefined;
}

/** Split a binary fact type's roles into the entity side and the other side. */
function rolesOf(
  ft: FactType,
  entityId: string,
): { entityRoleId: string; valueRoleId: string; } | undefined {
  const entityRole = ft.roles.find((r) => r.playerId === entityId);
  const valueRole = ft.roles.find((r) => r.id !== entityRole?.id);
  if (!entityRole || !valueRole) return undefined;
  return { entityRoleId: entityRole.id, valueRoleId: valueRole.id };
}

function hasMandatory(ft: FactType, roleId: string): boolean {
  return ft.constraints.some((c) => c.type === "mandatory" && c.roleId === roleId);
}

function hasUniqueness(ft: FactType, roleId: string): boolean {
  return ft.constraints.some(
    (c) =>
      c.type === "internal_uniqueness"
      && c.roleIds.length === 1
      && c.roleIds[0] === roleId,
  );
}

function hasValueConstraint(ft: FactType, roleId: string): boolean {
  return ft.constraints.some(
    (c) => c.type === "value_constraint" && (c.roleId === roleId || c.roleId === undefined),
  );
}

/** Any fact type whose roles are played by both object types. */
function haveRelationship(model: OrmModel, id1: string, id2: string): boolean {
  return model.factTypes.some(
    (ft) =>
      ft.roles.some((r) => r.playerId === id1)
      && ft.roles.some((r) => r.playerId === id2),
  );
}

// ---------------------------------------------------------------------------
// Text extraction (tier-agnostic: works on raw or canonical sourceText)
// ---------------------------------------------------------------------------

/** Columns asserted non-null by this pattern. */
function notNullColumns(p: SqlPatternContext): string[] {
  if (p.kind === "not_null") {
    return p.columns ? [...p.columns] : [];
  }
  // WHERE guards: match each `col IS NOT NULL` (raw) or `NOT col IS
  // NULL` (sqlglot's canonical rendering).
  const columns = new Set<string>();
  const raw = /(\w+(?:\.\w+)?)\s+IS\s+NOT\s+NULL/gi;
  const canonical = /NOT\s+(\w+(?:\.\w+)?)\s+IS\s+NULL/gi;
  for (const regex of [raw, canonical]) {
    let m;
    while ((m = regex.exec(p.sourceText)) !== null) {
      columns.add(stripQualifier(m[1]!));
    }
  }
  return [...columns];
}

/** Every `col IN ('a', 'b', ...)` enumeration in the text. */
function inListValues(text: string): Array<{ column: string; values: string[]; }> {
  const out: Array<{ column: string; values: string[]; }> = [];
  const regex = /(\w+(?:\.\w+)?)\s+IN\s*\(([^)]*)\)/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const values = m[2]!
      .split(",")
      .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
      .filter((v) => v.length > 0 && !v.startsWith("SELECT"));
    if (values.length > 0) {
      out.push({ column: stripQualifier(m[1]!), values });
    }
  }
  return out;
}

/**
 * Values enumerated by CASE branches: from the regex tier's
 * `details.values`, or parsed from `WHEN col = 'x'` branches in the
 * canonical text. Only single-column CASEs qualify.
 */
function caseBranchValues(p: SqlPatternContext): Array<{ column: string; values: string[]; }> {
  const detailValues = p.details?.["values"];
  if (Array.isArray(detailValues) && p.columns?.length === 1) {
    const values = detailValues.filter((v): v is string => typeof v === "string");
    return values.length > 0 ? [{ column: stripQualifier(p.columns[0]!), values }] : [];
  }

  const byColumn = new Map<string, string[]>();
  const regex = /WHEN\s+(\w+(?:\.\w+)?)\s*=\s*'([^']*)'/gi;
  let m;
  while ((m = regex.exec(p.sourceText)) !== null) {
    const column = stripQualifier(m[1]!);
    const list = byColumn.get(column) ?? [];
    if (!list.includes(m[2]!)) list.push(m[2]!);
    byColumn.set(column, list);
  }
  if (byColumn.size !== 1) return [];
  return [...byColumn.entries()].map(([column, values]) => ({ column, values }));
}

function stripQualifier(column: string): string {
  return column.includes(".") ? column.slice(column.lastIndexOf(".") + 1) : column;
}

function provenance(file: MinedSqlFile, p: SqlPatternContext): string {
  return `[${file.sourcePath}:${p.startLine}, ${p.parseLevel}]`;
}
