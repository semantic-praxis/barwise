/**
 * Constraint routing for dialect-targeted DDL export
 * (sql-dialect-capability spec, WS2).
 *
 * Walks the model's constraints, decides which ones the relational
 * mapping has already realized structurally (PK, FK, NOT NULL), and
 * routes the rest through the dialect capability profile:
 *
 *   - expressible and native/informational -> an extra table clause
 *     (UNIQUE or CHECK) for the DDL adapter to inject
 *   - expressible but absent in the dialect, or not expressible in
 *     SQL DDL at all -> the ConstraintSpec spillway (FORML
 *     verbalization + pseudocode + example) plus a SQL comment
 *
 * Everything here is deterministic: same model, same profile, same
 * routing.
 */

import { buildConstraintSpec } from "../annotation/constraintSpec.js";
import type { ConstraintSpec } from "../export/types.js";
import { type Constraint, isOverSubtypes } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { ConstraintInView, OrmModel } from "../model/OrmModel.js";
import { findRole } from "../model/roleLookup.js";
import { subtypeOperands } from "../model/subtypeOperands.js";
import { renderValuePredicate } from "../sql/valuePredicate.js";
import { ConstraintVerbalizer } from "../verbalization/index.js";
import { DIALECT_PROFILES, type DialectCapabilityProfile } from "./dialectCapabilities.js";
import type { RelationalSchema, RoutedUnique, Table } from "./RelationalSchema.js";

/** A constraint clause to inject into a rendered CREATE TABLE. */
export interface RoutedClause {
  readonly tableName: string;
  /** The clause SQL, e.g. `UNIQUE (email)` or `CHECK (status IN ('a'))`. */
  readonly sql: string;
  /** Whether the dialect enforces the clause or only records it. */
  readonly channel: "native" | "informational";
  /**
   * A UNIQUE clause's columns, so a format that writes uniqueness in its
   * own form (dbt) reads them rather than parsing the SQL. Absent on a
   * CHECK.
   */
  readonly columns?: readonly string[];
}

/** A constraint that degrades to the ConstraintSpec spillway. */
export interface SpilledConstraint {
  /** The table the constraint is closest to, when one is known. */
  readonly tableName?: string;
  /** Why it spilled, e.g. `CHECK is not supported by snowflake`. */
  readonly reason: string;
  readonly spec: ConstraintSpec;
}

/** A constraint the routing put on a table, as a clause or a spilled comment. */
export interface ConstraintPlacement {
  readonly tableName: string;
  /** The constraint placed, as the router saw it: not an id to look up again. */
  readonly inView: ConstraintInView;
}

/** The routing decision for a whole model. */
export interface ConstraintRouting {
  readonly clauses: readonly RoutedClause[];
  readonly spilled: readonly SpilledConstraint[];
  /**
   * Each constraint the routing wrote on a table, once per table: what
   * DDL lineage lists as that table's source, since changing the
   * constraint changes the table's text (barwise-20o).
   */
  readonly placements: readonly ConstraintPlacement[];
}

/**
 * A target with no UNIQUE and no CHECK clause: what a format that renders
 * only the relational schema (OpenAPI, Avro, dbt) can carry. Keys stay
 * native because the schema carries them; the router never reads them.
 */
const NO_CLAUSES: DialectCapabilityProfile = {
  ...DIALECT_PROFILES.postgres,
  unique: "absent",
  check: "absent",
};

/**
 * The constraints a format that renders only `schema` drops: every one
 * the router would spill if the target had neither UNIQUE nor CHECK, by
 * the same rule DDL uses for "realized by the mapping"
 * (schema-export-constraint-specs.spec.md).
 *
 * One spec per constraint routed, not per distinct sentence: two
 * constraints that verbalize alike are both reported, where DDL's
 * comment pass keeps one per table. A value type's own value constraint
 * is routed once for each role that constrains a column, so it is
 * reported once per column, each spec naming its own role -- each column
 * is a check to implement.
 */
export function unreportedConstraintSpecs(
  model: OrmModel,
  schema: RelationalSchema,
): ConstraintSpec[] {
  return specsOnce(routeAll(model, schema, NO_CLAUSES, "this format").spilled);
}

/**
 * A target with UNIQUE and no CHECK: a format that writes uniqueness in
 * its own form but no predicate (dbt's `unique` and combination tests).
 */
const UNIQUE_ONLY: DialectCapabilityProfile = { ...NO_CLAUSES, unique: "native" };

/**
 * What a format that can state uniqueness, and nothing the schema does not
 * carry otherwise, writes and drops: the UNIQUEs the DDL export writes,
 * by the router's own decision, and the specs of every other constraint,
 * as `unreportedConstraintSpecs` reports them (dbt-alternate-uniqueness.spec.md).
 * Each UNIQUE is listed once per table and column set: two constraints can
 * write one clause, and dbt refuses two tests of one name.
 */
export function routeUniqueOnly(
  model: OrmModel,
  schema: RelationalSchema,
): { uniques: RoutedUnique[]; constraintSpecs: ConstraintSpec[]; } {
  const { clauses, spilled } = routeAll(model, schema, UNIQUE_ONLY, "this format");
  const uniques = clauses.flatMap((c) =>
    c.columns ? [{ tableName: c.tableName, columns: c.columns }] : []
  );
  return {
    uniques: dedupeBy(uniques, (u) => JSON.stringify([u.tableName, [...u.columns].sort()])),
    constraintSpecs: specsOnce(spilled),
  };
}

/** One spec per constraint spilled, in order. */
function specsOnce(spilled: readonly RoutedSpill[]): ConstraintSpec[] {
  const seen = new Set<Constraint>();
  const specs: ConstraintSpec[] = [];
  for (const s of spilled) {
    if (seen.has(s.constraint)) continue;
    seen.add(s.constraint);
    specs.push(s.spec);
  }
  return specs;
}

/**
 * `constraintSpecs` as an ExportResult field: present only when there is
 * something to report, so an absent field and an empty list cannot mean
 * different things to a reader of the result.
 */
export function withConstraintSpecs(
  specs: readonly ConstraintSpec[],
): { constraintSpecs?: readonly ConstraintSpec[]; } {
  return specs.length > 0 ? { constraintSpecs: specs } : {};
}

/**
 * Route every non-realized constraint in the model through the
 * dialect capability profile.
 */
export function routeConstraints(
  model: OrmModel,
  schema: RelationalSchema,
  profile: DialectCapabilityProfile,
  dialectName: string,
): ConstraintRouting {
  const { clauses, spilled, placements } = routeAll(model, schema, profile, dialectName);
  return {
    // Once per table and constraint: a constraint can spill twice at one
    // table (a mandatory and its column), and is still one source. Before
    // the text dedupe, deliberately: two constraints that write the same
    // clause are both sources, since changing either changes the table.
    placements: onePerTable(placements),
    clauses: dedupeBy(clauses, (c) => JSON.stringify([c.tableName, c.sql])),
    spilled: dedupeBy(spilled, (s) => JSON.stringify([s.tableName ?? "", s.spec.verbalization]))
      .map(({ tableName, reason, spec }) => ({ tableName, reason, spec })),
  };
}

/** A spill with the constraint it came from, before any dedupe. */
interface RoutedSpill extends SpilledConstraint {
  readonly constraint: Constraint;
}

function routeAll(
  model: OrmModel,
  schema: RelationalSchema,
  profile: DialectCapabilityProfile,
  dialectName: string,
): { clauses: RoutedClause[]; spilled: RoutedSpill[]; placements: ConstraintPlacement[]; } {
  const clauses: RoutedClause[] = [];
  const spilled: RoutedSpill[] = [];
  const placements: ConstraintPlacement[] = [];
  const place = (inView: ConstraintInView, tableName: string | undefined): void => {
    if (tableName !== undefined) placements.push({ tableName, inView });
  };
  const verbalizer = new ConstraintVerbalizer();

  const spill = (inView: ConstraintInView, reason: string, tableName?: string): void => {
    place(inView, tableName);
    spilled.push({
      tableName,
      reason,
      spec: buildConstraintSpec(inView, model, verbalizer),
      constraint: inView[0],
    });
  };

  const route = (
    capability: "unique" | "check",
    clauseSql: string,
    tableName: string,
    inView: ConstraintInView,
    columns?: readonly string[],
  ): void => {
    const channel = profile[capability];
    if (channel === "absent") {
      spill(
        inView,
        `${capability === "check" ? "CHECK" : "UNIQUE"} is not supported by ${dialectName}`,
        tableName,
      );
      return;
    }
    place(inView, tableName);
    clauses.push({ tableName, sql: clauseSql, channel, ...(columns ? { columns } : {}) });
  };
  const unique = (columns: readonly string[], tableName: string, inView: ConstraintInView) =>
    route("unique", `UNIQUE (${columns.join(", ")})`, tableName, inView, columns);

  // A constraint across fact types is placed by the fact types it spans,
  // never by the one a 2.0 file nests it under (orm-format-3, Open
  // decision 9): its spill goes to the table of the first of them, in
  // model order, that has one -- except an external uniqueness with a
  // column, noted beside that column as it always was, and a constraint
  // over subtypes, which spans no fact type and goes to its supertype's
  // table.
  const routeAcross = (inView: ConstraintInView): void => {
    const [c] = inView;
    // A constraint over subtypes travels in the barwise annotation, as the
    // 2.0 subtype flags it replaces did (orm-format-3 WS4b), which keeps
    // it on a DDL round trip. Each subtype is a table whose key references
    // the supertype's, so the rule spans tables and no clause states it;
    // it spills at the supertype's table, so an export without the
    // annotation still reports it (schema-export-subtype-constraints.spec.md).
    if (isOverSubtypes(c)) {
      const { supertypeId } = subtypeOperands(c.subtypeFactIds, model);
      spill(
        inView,
        "a rule over subtypes spans their tables, which no clause can state",
        schema.tables.find((t) => t.sourceElementId === supertypeId)?.name,
      );
      return;
    }
    if (c.type === "external_uniqueness") {
      const cols = c.roleIds.map((r) => columnsForJoinedRole(r, model, schema));
      const resolved = cols.filter((r) => r !== undefined);
      if (resolved.length === 0) {
        spill(inView, "the roles map to no column", nearestTable(inView));
        return;
      }
      // A key that is not one clause is noted beside the columns it has.
      const table = resolved[0]!.table;
      const problems = [
        ...(new Set(resolved.map((r) => r.table)).size > 1
          ? ["the roles map to more than one table"]
          : []),
        ...(resolved.length < cols.length ? ["a role maps to no column"] : []),
      ];
      if (problems.length > 0) {
        spill(inView, problems.join(", and "), table);
      } else if (
        // Columns that are the whole primary key are unique already: an
        // external identifier keys its table so (external-preferred-identifier.spec.md),
        // and the internal branch skips the same case.
        !isWholePrimaryKey({ table, columns: resolved.flatMap((r) => r.columns) }, schema)
      ) {
        unique(resolved.flatMap((r) => r.columns), table, inView);
      }
      return;
    }
    spill(inView, "not expressible in SQL DDL", nearestTable(inView));
  };

  const nearestTable = (inView: ConstraintInView): string | undefined => {
    for (const f of model.factTypesNaming(inView)) {
      const table = tableForFactType(f, model, schema);
      if (table !== undefined) return table;
    }
    return undefined;
  };

  for (const inView of model.everyConstraint()) {
    const [c, ft] = inView;
    if (ft === undefined) {
      routeAcross(inView);
      continue;
    }
    switch (c.type) {
      case "mandatory": {
        // Realized only by a NOT NULL column for the role in its own
        // player's table (mandatory-role-routing.spec.md, barwise-plq).
        const gap = mandatoryGap(c.roleId, ft, model, schema);
        if (gap) spill(inView, gap.reason, gap.table ?? tableForFactType(ft, model, schema));
        break;
      }

      case "internal_uniqueness": {
        // The mapping does not realize a single-role constraint on the
        // value side of an entity-value binary (a secondary unique
        // column), nor one on a binary between two entities whose fact it
        // stored anywhere but the role's own player's table (barwise-hjy),
        // nor a second key of an n-ary table (barwise-kgh).
        const single = c.roleIds.length === 1 ? c.roleIds[0]! : undefined;
        const col = single ? valueColumnForUniqueness(single, ft, model, schema) : undefined;
        // ... unless the mapping realized it as the primary key after
        // all. Since barwise-967 the identifying binary IS the key, so
        // routing its uniqueness would emit
        // `UNIQUE (medical_record_number)` beside
        // `PRIMARY KEY (medical_record_number)` -- a clause the primary
        // key already enforces.
        if (col && !isPrimaryKey(col, schema)) {
          unique([col.column], col.table, inView);
        }
        const between = single ? entityBinaryUniqueColumns(single, ft, model, schema) : undefined;
        if (between === "unlocated") {
          spill(inView, "the roles map to no column", tableForFactType(ft, model, schema));
        } else if (typeof between === "object" && !isWholePrimaryKey(between, schema)) {
          unique(between.columns, between.table, inView);
        }
        // An n-ary fact type's table is keyed on one of its uniqueness
        // constraints; any other one is a UNIQUE on the same table
        // (barwise-kgh). "Encounter has Diagnosis at DiagnosisRank" is
        // keyed on (encounter, diagnosis) and unique on (encounter, rank).
        if (ft.arity > 2) {
          const spanned = associativeColumns(c.roleIds, schema);
          if (spanned && !isWholePrimaryKey(spanned, schema)) {
            unique(spanned.columns, spanned.table, inView);
          }
        }
        break;
      }

      case "value_constraint": {
        routeValueConstraint(c, ft);
        break;
      }

      case "value_comparison": {
        const col1 = columnForRole(c.roleId1, model, schema);
        const col2 = columnForRole(c.roleId2, model, schema);
        if (col1 && col2 && col1.table === col2.table) {
          route(
            "check",
            `CHECK (${col1.column} ${c.operator} ${col2.column})`,
            col1.table,
            inView,
          );
        } else {
          spill(inView, "the compared roles map to different tables", col1?.table);
        }
        break;
      }

      default:
        spill(inView, "not expressible in SQL DDL", tableForFactType(ft, model, schema));
        break;
    }
  }

  // Object-type-level value constraints (declared on the value type
  // rather than a role) apply to every column the value type produces:
  // synthesize a role-level constraint per fact type and route it the
  // same way. An n-ary fact type's value role has its own column since
  // barwise-kgh, so it takes the CHECK too; before that there was no
  // column to put one on.
  for (const ot of model.objectTypes) {
    if (ot.kind !== "value" || !ot.valueConstraint) continue;
    for (const ft of model.factTypes) {
      if (ft.arity < 2) continue;
      // Every role it plays: an n-ary can use one value type twice (a
      // start and an end date), and each is its own column (PR #580 review).
      for (const valueRole of ft.roles.filter((r) => r.playerId === ot.id)) {
        routeValueConstraint(
          {
            type: "value_constraint",
            roleId: valueRole.id,
            values: ot.valueConstraint.values,
            ranges: ot.valueConstraint.ranges,
          },
          ft,
        );
      }
    }
  }

  // A key a generated key replaced is still a uniqueness of its table,
  // which the schema states rather than the model: a many-to-many table's
  // spanning uniqueness is realized by its key, and no constraint is
  // routed as a UNIQUE for it (surrogate-key-export.spec.md). Written once:
  // an external identifier's own uniqueness is already a clause over the
  // same columns once they are no longer the key.
  if (profile.unique !== "absent") {
    for (const table of schema.tables) {
      const key = table.naturalKey;
      if (!key) continue;
      const same = clauses.some((c) =>
        c.tableName === table.name && c.columns?.length === key.length
        && key.every((k) => c.columns!.includes(k))
      );
      if (same) continue;
      clauses.push({
        tableName: table.name,
        sql: `UNIQUE (${key.join(", ")})`,
        channel: profile.unique,
        columns: key,
      });
    }
  }

  return { clauses, spilled, placements };

  function routeValueConstraint(
    c: Extract<Constraint, { type: "value_constraint"; }>,
    ft: FactType,
  ): void {
    const roleId = c.roleId ?? valueRoleOf(ft, model);
    const col = roleId ? columnForRole(roleId, model, schema) : undefined;
    const predicate = col ? renderValuePredicate(col.column, c.values, c.ranges) : "";
    const inView: ConstraintInView = [c, ft];
    if (col && predicate) {
      route("check", `CHECK (${predicate})`, col.table, inView);
    } else {
      spill(inView, "the constrained role maps to no single column", col?.table);
    }
  }
}

/** Each placement once per table and constraint, in order: one pass. */
function onePerTable(placements: readonly ConstraintPlacement[]): ConstraintPlacement[] {
  const seen = new Map<string, Set<unknown>>();
  return placements.filter(({ tableName, inView }) => {
    const placed = seen.get(tableName) ?? new Set();
    seen.set(tableName, placed);
    if (placed.has(inView[0])) return false;
    placed.add(inView[0]);
    return true;
  });
}

/** Keep the first occurrence of each key, preserving order. */
function dedupeBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Role -> column resolution
// ---------------------------------------------------------------------------

interface ResolvedColumn {
  readonly table: string;
  readonly column: string;
}

/**
 * Find the schema column a role maps to. Value columns carry the
 * ENTITY role id as their `sourceRoleId` (the mapper anchors the
 * column to the entity side), so a VALUE-side role falls back to its
 * partner role in the same binary fact type. Entity roles get no such
 * fallback -- the partner's column holds the partner's value, not
 * this role's.
 */
function columnForRole(
  roleId: string,
  model: OrmModel,
  schema: RelationalSchema,
): ResolvedColumn | undefined {
  const direct = findColumn(roleId, schema);
  if (direct) return direct;

  const located = findRole(roleId, undefined, model);
  if (!located || located.factType.arity !== 2) return undefined;
  if (model.getObjectType(located.role.playerId)?.kind !== "value") return undefined;
  const partner = located.factType.roles.find((r) => r.id !== roleId);
  return partner ? findColumn(partner.id, schema) : undefined;
}

/**
 * Resolve a role for an external uniqueness: the columns representing
 * that role's PLAYER relative to the joined table. Unlike
 * `columnForRole`, the partner fallback also applies to entity roles --
 * the FK columns keyed by the partner role hold which player instance
 * the row relates to, which is exactly what the joint uniqueness
 * ranges over. An entity player is every column of its foreign key, as
 * `associativeColumns` takes them: naming only the first wrote a UNIQUE
 * over part of a composite key, which rejects valid rows. A value player
 * is one column, the first carrying the role, as it always was: a model
 * that maps one binary twice puts the role on two columns, and only the
 * first is the value (auction `catalog.orm.yaml`, Model has ModelId).
 */
function columnsForJoinedRole(
  roleId: string,
  model: OrmModel,
  schema: RelationalSchema,
): { table: string; columns: string[]; } | undefined {
  const located = findRole(roleId, undefined, model);
  const valuePlayer = located !== undefined
    && model.getObjectType(located.role.playerId)?.kind === "value";
  const columnsOf = (id: string) => {
    if (!valuePlayer) {
      const found = findColumns(id, schema);
      return found && { table: found.table.name, columns: found.columns };
    }
    const one = findColumn(id, schema);
    return one && { table: one.table, columns: [one.column] };
  };
  const direct = columnsOf(roleId);
  if (direct) return direct;

  if (!located || located.factType.arity !== 2) return undefined;
  const partner = located.factType.roles.find((r) => r.id !== roleId);
  return partner ? columnsOf(partner.id) : undefined;
}

/** Every column carrying a role, in the first table that has one. */
function findColumns(
  roleId: string,
  schema: RelationalSchema,
): { table: Table; columns: string[]; } | undefined {
  for (const table of schema.tables) {
    const columns = table.columns.filter((cl) => cl.sourceRoleId === roleId).map((cl) => cl.name);
    if (columns.length > 0) return { table, columns };
  }
  return undefined;
}

function findColumn(roleId: string, schema: RelationalSchema): ResolvedColumn | undefined {
  for (const table of schema.tables) {
    const col = table.columns.find((cl) => cl.sourceRoleId === roleId);
    if (col) return { table: table.name, column: col.name };
  }
  return undefined;
}

/** Whether a resolved column is, by itself, its table's primary key. */
function isPrimaryKey(col: ResolvedColumn, schema: RelationalSchema): boolean {
  const table = schema.tables.find((t) => t.name === col.table);
  const key = table?.primaryKey.columnNames;
  return key?.length === 1 && key[0] === col.column;
}

/**
 * The columns of one associative table that a set of roles maps to, in
 * table order, or undefined when the roles do not all land in one table.
 * An entity role can map to several columns (a composite foreign key), so
 * every column carrying the role counts, not only the first.
 */
function associativeColumns(
  roleIds: readonly string[],
  schema: RelationalSchema,
): { table: string; columns: string[]; } | undefined {
  for (const table of schema.tables) {
    const columns = table.columns.filter((c) => c.sourceRoleId && roleIds.includes(c.sourceRoleId));
    const covered = new Set(columns.map((c) => c.sourceRoleId));
    if (roleIds.every((r) => covered.has(r))) {
      return { table: table.name, columns: columns.map((c) => c.name) };
    }
  }
  return undefined;
}

/** Whether these columns are exactly the table's primary key. */
function isWholePrimaryKey(
  spanned: { table: string; columns: readonly string[]; },
  schema: RelationalSchema,
): boolean {
  const key = schema.tables.find((t) => t.name === spanned.table)?.primaryKey.columnNames ?? [];
  return key.length === spanned.columns.length && key.every((k) => spanned.columns.includes(k));
}

/**
 * The columns a single-role uniqueness on a binary between two entities
 * needs UNIQUE on, "realized" when the mapping already realizes it,
 * "unlocated" when neither role has columns where the mapping stores such
 * a fact, or undefined when it is not a binary between two entities
 * (one-to-one-entity-uniqueness.spec.md, barwise-hjy). The fact is stored
 * in one of three places:
 *
 *   - the role's own columns, in its own player's table: they are
 *     single-valued, which is the uniqueness itself;
 *   - the role's own columns, in another table (an associative table, or
 *     the table of an entity objectifying the fact type): each value may
 *     appear once;
 *   - the partner role's columns, in the partner's player's table (a
 *     one-to-one absorbed on the other side): each value may appear once.
 */
function entityBinaryUniqueColumns(
  roleId: string,
  ft: FactType,
  model: OrmModel,
  schema: RelationalSchema,
): { table: string; columns: string[]; } | "realized" | "unlocated" | undefined {
  if (ft.arity !== 2) return undefined;
  const role = ft.getRoleById(roleId);
  const partner = ft.roles.find((r) => r.id !== roleId);
  if (!role || !partner) return undefined;
  const isEntity = (id: string) => model.getObjectType(id)?.kind === "entity";
  if (!isEntity(role.playerId) || !isEntity(partner.playerId)) return undefined;
  const found = (hit: { table: Table; columns: string[]; }) => ({
    table: hit.table.name,
    columns: hit.columns,
  });

  const own = findColumns(roleId, schema);
  if (own && inPlayerTable(own, roleId, ft)) return "realized";
  if (own) return found(own);
  const absorbed = findColumns(partner.id, schema);
  if (absorbed && absorbed.table.sourceElementId === partner.playerId) return found(absorbed);
  // Neither role's columns are where the three places put them: the
  // mapping stored the fact nowhere this can see, so the caller spills
  // rather than counting it realized.
  return "unlocated";
}

/**
 * Whether a role's columns sit in its own player's table: where the
 * mapping stores a fact it realizes as a column of the player. Both the
 * one-to-one uniqueness rule and the mandatory rule read it, so they
 * agree on where a role's fact lives.
 */
function inPlayerTable(found: { table: Table; }, roleId: string, ft: FactType): boolean {
  return found.table.sourceElementId === ft.getRoleById(roleId)?.playerId;
}

/**
 * Why the relational mapping does not enforce a mandatory role, and the
 * table to note it at, or undefined when it does: a NOT NULL column for
 * the role in its own player's table (mandatory-role-routing.spec.md,
 * barwise-plq). The reasons name the shape, so the report says what a
 * reader would have to add.
 */
function mandatoryGap(
  roleId: string,
  ft: FactType,
  model: OrmModel,
  schema: RelationalSchema,
): { reason: string; table?: string; } | undefined {
  const found = findColumns(roleId, schema);
  if (found && inPlayerTable(found, roleId, ft)) {
    const nullable = found.table.columns.some((c) => c.sourceRoleId === roleId && c.nullable);
    if (!nullable) return undefined;
    return {
      reason: ft.arity === 1
        ? "a unary fact maps to a nullable flag, which no column constraint makes true"
        : "the role's column is nullable",
      table: found.table.name,
    };
  }
  const playerId = ft.getRoleById(roleId)?.playerId;
  if (model.getObjectType(playerId ?? "")?.kind === "value") {
    return {
      reason: "a value type has no table in which to require the role",
      table: found?.table.name,
    };
  }
  const playerTable = schema.tables.find((t) => t.sourceElementId === playerId);
  return {
    reason: "each instance must appear in another table, which no column can require",
    table: found?.table.name ?? playerTable?.name,
  };
}

/**
 * For a single-role uniqueness constraint: the value column it makes
 * unique, when the role is the value side of an entity-value binary.
 */
function valueColumnForUniqueness(
  roleId: string,
  ft: FactType,
  model: OrmModel,
  schema: RelationalSchema,
): ResolvedColumn | undefined {
  if (ft.arity !== 2) return undefined;
  const role = ft.getRoleById(roleId);
  if (!role) return undefined;
  const player = model.getObjectType(role.playerId);
  const partner = ft.roles.find((r) => r.id !== roleId);
  const partnerPlayer = partner ? model.getObjectType(partner.playerId) : undefined;
  if (player?.kind !== "value" || partnerPlayer?.kind !== "entity") return undefined;
  return partner ? findColumn(partner.id, schema) : undefined;
}

/** The role id of the value side of an entity-value binary, if any. */
function valueRoleOf(ft: FactType, model: OrmModel): string | undefined {
  if (ft.arity !== 2) return undefined;
  const valueRole = ft.roles.find(
    (r) => model.getObjectType(r.playerId)?.kind === "value",
  );
  return valueRole?.id;
}

/** The table nearest to a fact type, for placing spillway comments. */
function tableForFactType(
  ft: FactType,
  model: OrmModel,
  schema: RelationalSchema,
): string | undefined {
  // The fact type's own table (associative), if it has one.
  const own = schema.tables.find((t) => t.sourceElementId === ft.id);
  if (own) return own.name;
  // Otherwise the table of the first entity player.
  for (const role of ft.roles) {
    const player = model.getObjectType(role.playerId);
    if (player?.kind === "entity") {
      const table = schema.tables.find((t) => t.sourceElementId === player.id);
      if (table) return table.name;
    }
  }
  return undefined;
}
