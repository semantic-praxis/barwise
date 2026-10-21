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

import {
  type Constraint,
  type ConstraintInView,
  type ConstraintSpec,
  type FactType,
  type OrmModel,
  roleIdsOf,
  subtypeFactIdsOf,
} from "@barwise/core";
import { generateCounterexampleInView } from "@barwise/core/counterexample";
import type { RelationalSchema } from "@barwise/core/mapping";
import { ConstraintVerbalizer } from "@barwise/core/verbalization";
import type { DialectCapabilityProfile } from "./dialectCapabilities.js";
import { renderValuePredicate } from "./valuePredicate.js";

/** A constraint clause to inject into a rendered CREATE TABLE. */
export interface RoutedClause {
  readonly tableName: string;
  /** The clause SQL, e.g. `UNIQUE (email)` or `CHECK (status IN ('a'))`. */
  readonly sql: string;
  /** Whether the dialect enforces the clause or only records it. */
  readonly channel: "native" | "informational";
}

/** A constraint that degrades to the ConstraintSpec spillway. */
export interface SpilledConstraint {
  /** The table the constraint is closest to, when one is known. */
  readonly tableName?: string;
  /** Why it spilled, e.g. `CHECK is not supported by snowflake`. */
  readonly reason: string;
  readonly spec: ConstraintSpec;
}

/** The routing decision for a whole model. */
export interface ConstraintRouting {
  readonly clauses: readonly RoutedClause[];
  readonly spilled: readonly SpilledConstraint[];
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
  const clauses: RoutedClause[] = [];
  const spilled: SpilledConstraint[] = [];
  const verbalizer = new ConstraintVerbalizer();

  const spill = (inView: ConstraintInView, reason: string, tableName?: string): void => {
    spilled.push({
      tableName,
      reason,
      spec: buildConstraintSpec(inView, model, verbalizer),
    });
  };

  const route = (
    capability: "unique" | "check",
    clauseSql: string,
    tableName: string,
    inView: ConstraintInView,
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
    clauses.push({ tableName, sql: clauseSql, channel });
  };

  // A constraint across fact types is placed by the fact types it spans,
  // never by the one a 2.0 file nests it under (orm-format-3, Open
  // decision 9): its spill goes to the table of the first of them, in
  // model order, that has one -- except an external uniqueness with a
  // column, noted beside that column as it always was.
  const routeAcross = (inView: ConstraintInView): void => {
    const [c] = inView;
    // A constraint over subtypes travels in the barwise annotation, as the
    // 2.0 subtype flags it replaces did (orm-format-3 WS4b); it names no
    // role, so it has no column or table here, and nothing below it reads
    // one.
    if (subtypeFactIdsOf(c).length > 0) return;
    if (c.type === "external_uniqueness") {
      const cols = c.roleIds.map((r) => columnForJoinedRole(r, model, schema));
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
      } else {
        const columnList = resolved.map((r) => r.column).join(", ");
        route("unique", `UNIQUE (${columnList})`, table, inView);
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
      // Realized structurally by the relational mapping.
      case "mandatory":
        break;

      case "internal_uniqueness": {
        // The only uniqueness the mapping does not realize is a
        // single-role constraint on the value side of an
        // entity-value binary (a secondary unique column).
        const col = c.roleIds.length === 1
          ? valueColumnForUniqueness(c.roleIds[0]!, ft, model, schema)
          : undefined;
        // ... unless the mapping realized it as the primary key after
        // all. Since barwise-967 the identifying binary IS the key, so
        // routing its uniqueness would emit
        // `UNIQUE (medical_record_number)` beside
        // `PRIMARY KEY (medical_record_number)` -- a clause the primary
        // key already enforces.
        if (col && !isPrimaryKey(col, schema)) {
          route("unique", `UNIQUE (${col.column})`, col.table, inView);
        }
        // An n-ary fact type's table is keyed on one of its uniqueness
        // constraints; any other one is a UNIQUE on the same table
        // (barwise-kgh). "Encounter has Diagnosis at DiagnosisRank" is
        // keyed on (encounter, diagnosis) and unique on (encounter, rank).
        if (ft.arity > 2) {
          const spanned = associativeColumns(c.roleIds, schema);
          if (spanned && !isWholePrimaryKey(spanned, schema)) {
            route("unique", `UNIQUE (${spanned.columns.join(", ")})`, spanned.table, inView);
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

  return {
    clauses: dedupeBy(clauses, (c) => JSON.stringify([c.tableName, c.sql])),
    spilled: dedupeBy(spilled, (s) => JSON.stringify([s.tableName ?? "", s.spec.verbalization])),
  };

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
// ConstraintSpec construction (the spillway payload)
// ---------------------------------------------------------------------------

function buildConstraintSpec(
  inView: ConstraintInView,
  model: OrmModel,
  verbalizer: ConstraintVerbalizer,
): ConstraintSpec {
  const [c, ft] = inView;
  let verbalization: string;
  try {
    verbalization = verbalizer.reportInView(inView, model).verbalization;
  } catch {
    // The fact type it lives in, or the ones it spans: never a 2.0 host.
    const names = model.factTypesNaming(inView).map((f) => `"${f.name}"`);
    const named = names.length > 0 ? names.join(", ") : "no fact type (its roles do not resolve)";
    verbalization = `${c.type} constraint on ${named}`;
  }

  let example: string;
  try {
    const ce = generateCounterexampleInView(inView, model);
    example = ce
      ? `Forbidden: ${ce.text}`
      : "No concrete example available; see the verbalization.";
  } catch {
    example = "No concrete example available; see the verbalization.";
  }

  return {
    verbalization,
    pseudocode: constraintPseudocode(c, ft, model),
    example,
  };
}

/**
 * A per-type pseudocode predicate: enough for a human or agent to
 * implement the constraint in query logic, a dbt test, or application
 * code.
 */
function constraintPseudocode(c: Constraint, ft: FactType | undefined, model: OrmModel): string {
  // Every kind that reads it is internal, so has a fact type.
  const fact = ft?.name ?? "";
  switch (c.type) {
    case "ring": {
      const templates: Record<string, string> = {
        irreflexive: `for all x: not ${fact}(x, x)`,
        asymmetric: `for all x, y: ${fact}(x, y) implies not ${fact}(y, x)`,
        antisymmetric: `for all x, y where x != y: ${fact}(x, y) implies not ${fact}(y, x)`,
        intransitive: `for all x, y, z: ${fact}(x, y) and ${fact}(y, z) implies not ${fact}(x, z)`,
        acyclic: `no cycle in the directed graph of ${fact}`,
        symmetric: `for all x, y: ${fact}(x, y) implies ${fact}(y, x)`,
        transitive: `for all x, y, z: ${fact}(x, y) and ${fact}(y, z) implies ${fact}(x, z)`,
        purely_reflexive: `for all x, y: ${fact}(x, y) implies x = y`,
      };
      return templates[c.ringType] ?? `ring(${c.ringType}) holds over ${fact}`;
    }
    case "frequency": {
      const max = c.max === "unbounded" ? "unbounded" : String(c.max);
      return `for each value combination of (${roleLabels(c.roleIds, ft, model)}): `
        + `count of occurrences in ${fact} is between ${c.min} and ${max}`;
    }
    case "cardinality": {
      const max = c.max === undefined ? "unbounded" : String(c.max);
      return `count of instances playing ${roleLabels([c.roleId], ft, model)} `
        + `is between ${c.min ?? 0} and ${max}`;
    }
    case "exclusion":
      return `no instance plays more than one of: ${roleLabels(roleIdsOf(c), ft, model)}`;
    case "exclusive_or":
      return `each instance plays exactly one of: ${roleLabels(roleIdsOf(c), ft, model)}`;
    case "disjunctive_mandatory":
      return `each instance plays at least one of: ${roleLabels(roleIdsOf(c), ft, model)}`;
    case "subset":
      return `population(${roleLabels(c.subsetRoleIds, ft, model)}) is a subset of `
        + `population(${roleLabels(c.supersetRoleIds, ft, model)})`;
    case "equality":
      return `population(${roleLabels(c.roleIds1, ft, model)}) equals `
        + `population(${roleLabels(c.roleIds2, ft, model)})`;
    case "external_uniqueness":
      return `the combination (${
        roleLabels(c.roleIds, ft, model)
      }) is unique across the population`;
    case "internal_uniqueness":
      return `the combination (${roleLabels(c.roleIds, ft, model)}) is unique within ${fact}`;
    case "value_constraint": {
      const values = c.values.length > 0 ? `one of {${c.values.join(", ")}}` : "";
      const ranges = (c.ranges ?? [])
        .map((r) => rangeText(r.min, r.max, r.minInclusive, r.maxInclusive))
        .join(" or ");
      const alternatives = [values, ranges].filter((s) => s.length > 0).join(" or ");
      return `value of ${
        roleLabels(c.roleId ? [c.roleId] : [], ft, model) || fact
      } is ${alternatives}`;
    }
    case "value_comparison":
      return `value(${roleLabels([c.roleId1], ft, model)}) ${c.operator} `
        + `value(${roleLabels([c.roleId2], ft, model)})`;
    case "mandatory":
      return `every instance of ${roleLabels([c.roleId], ft, model)} plays the role in ${fact}`;
    case "join_subset":
      return `projected tuples of the subset join path are contained in the superset join path`;
    case "join_equality":
      return `projected tuples of all join-path operands are identical`;
    case "join_exclusion":
      return `no tuple appears in the projection of more than one join-path operand`;
    default:
      return `${(c as Constraint).type} holds over ${fact}`;
  }
}

function rangeText(
  min: string | undefined,
  max: string | undefined,
  minInclusive: boolean | undefined,
  maxInclusive: boolean | undefined,
): string {
  const lower = min !== undefined ? `>${minInclusive === false ? "" : "="} ${min}` : "";
  const upper = max !== undefined ? `<${maxInclusive === false ? "" : "="} ${max}` : "";
  return [lower, upper].filter((s) => s.length > 0).join(" and ");
}

/** Human-readable labels for a role sequence: "Player.roleName" each. */
function roleLabels(
  roleIds: readonly string[],
  ft: FactType | undefined,
  model: OrmModel,
): string {
  return roleIds
    .map((roleId) => {
      const { role } = findRole(roleId, ft, model) ?? {};
      if (!role) return roleId;
      const player = model.getObjectType(role.playerId);
      return player ? `${player.name}.${role.name}` : role.name;
    })
    .join(", ");
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
 * Resolve a role for an external uniqueness: the column representing
 * that role's PLAYER relative to the joined table. Unlike
 * `columnForRole`, the partner fallback also applies to entity roles --
 * the FK column keyed by the partner role holds which player instance
 * the row relates to, which is exactly what the joint uniqueness
 * ranges over.
 */
function columnForJoinedRole(
  roleId: string,
  model: OrmModel,
  schema: RelationalSchema,
): ResolvedColumn | undefined {
  const direct = findColumn(roleId, schema);
  if (direct) return direct;

  const located = findRole(roleId, undefined, model);
  if (!located || located.factType.arity !== 2) return undefined;
  const partner = located.factType.roles.find((r) => r.id !== roleId);
  return partner ? findColumn(partner.id, schema) : undefined;
}

function findColumn(roleId: string, schema: RelationalSchema): ResolvedColumn | undefined {
  for (const table of schema.tables) {
    const col = table.columns.find((cl) => cl.sourceRoleId === roleId);
    if (col) return { table: table.name, column: col.name };
  }
  return undefined;
}

function findRole(
  roleId: string,
  preferred: FactType | undefined,
  model: OrmModel,
): { factType: FactType; role: FactType["roles"][number]; } | undefined {
  if (preferred) {
    const role = preferred.getRoleById(roleId);
    if (role) return { factType: preferred, role };
  }
  for (const ft of model.factTypes) {
    const role = ft.getRoleById(roleId);
    if (role) return { factType: ft, role };
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
 * For a single-role uniqueness constraint: the value column it makes
 * unique, when the role is the value side of an entity-value binary
 * (any other uniqueness is realized by the mapping itself).
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
