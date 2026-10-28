/**
 * The machine-readable comment a barwise DDL export writes, and the DDL
 * importer reads back (ddl-round-trip-fixed-point.spec.md, workstream 4).
 *
 * One line per entity table and per column: `-- barwise:v1 ` and one JSON
 * object. The importer otherwise guesses an entity's name from its table,
 * a fact type's name, readings and role names from its column, and has no
 * definitions at all -- about a file that was written from a model whose
 * names it already knew. JSON because a definition is free text, and
 * `JSON.stringify` keeps a quote, a colon or a newline on one line.
 *
 * Both sides call this module, so the format has one owner; the round-trip
 * test over the trial kernels and the examples pins it.
 */

import { type OrmModel, subtypeFlagsFromConstraints, validateReadingTemplate } from "@barwise/core";
import type { DerivationKind, DerivationRule, DerivationStorage, FactType } from "@barwise/core";
import type { RelationalSchema, RoutedUnique, Table } from "@barwise/core/mapping";

const PREFIX = "-- barwise:v1 ";
/** Any version's line, so a version this reader does not know is named, not taken for plain DDL. */
const ANY_VERSION = /^-- barwise:v(\d+) /;

/** An entity table: the entity it came from. */
export interface TableAnnotation {
  readonly kind: "table";
  readonly table: string;
  readonly entity: string;
  readonly referenceMode: string;
  readonly definition?: string;
  /** The fact type this entity objectifies, when its roles are columns of the table. */
  readonly objectifies?: Relationship;
  /**
   * Every subtype fact this entity is the subtype of, each with the
   * columns that reference its supertype's table and the fact's fields as
   * core stores them. Written on every table line, empty for an entity
   * that is no subtype, so that absence means only "written before this
   * field existed" (key-reference-tables.spec.md, requirement 4). Fields
   * are imported as stored, never re-derived: the mapper writes an
   * identifying subtype fact as a non-key foreign key when an
   * objectification identifies the same entity.
   */
  readonly supertypes?: readonly SupertypeLink[];
  /**
   * The columns the entity's stored preferred identifier is over
   * (annotation-preferred-identifier.spec.md). Written when they are not
   * the table's key, which the import reads as the identifier by itself:
   * an objectifier keyed on its relationship and identified by a value.
   * And written when they are a one-column key that an identifying
   * supertype link also is, which the import reads as the link alone.
   */
  readonly identifiedBy?: readonly string[];
}

/** One subtype fact, as a table line carries it. */
export interface SupertypeLink {
  readonly entity: string;
  readonly columns: readonly string[];
  readonly providesIdentification: boolean;
  readonly isExclusive: boolean;
  readonly isExhaustive: boolean;
  readonly definingRule?: DerivationRule;
}

/** A role of a table-wide fact type: its player and the table's columns for it. */
export interface RelationshipRole {
  readonly name: string;
  readonly player: string;
  /** One for a value role; one per key column of the referenced entity for an entity role. */
  readonly columns: readonly string[];
  readonly valueDefinition?: string;
}

/** A fact type spread over a whole table (ddl-round-trip-fixed-point.spec.md, workstream 5). */
export interface Relationship {
  readonly factType: string;
  readonly readings: readonly string[];
  readonly definition?: string;
  readonly roles: readonly RelationshipRole[];
}

/** A table that is a fact type: a many-to-many, a one-to-one kept apart, an n-ary. */
export interface FactTableAnnotation extends Relationship {
  readonly kind: "factTable";
  readonly table: string;
}

/** A role of a column's fact type, in the fact type's order. */
export interface AnnotatedRole {
  readonly name: string;
  readonly player: string;
}

/** A column: the binary fact type it came from. */
export interface ColumnAnnotation {
  readonly kind: "column";
  readonly table: string;
  readonly column: string;
  readonly factType: string;
  readonly readings: readonly string[];
  readonly roles: readonly [AnnotatedRole, AnnotatedRole];
  /** Which of `roles` the table's own entity plays. */
  readonly rowRole: 0 | 1;
  readonly definition?: string;
  /** The other player's definition, when it is a value type. */
  readonly valueDefinition?: string;
}

export type Annotation = TableAnnotation | FactTableAnnotation | ColumnAnnotation;

/** One annotation as its comment line. */
export function renderAnnotation(annotation: Annotation): string {
  return PREFIX + JSON.stringify(annotation);
}

/**
 * A fact type as the table's columns carry it, found through each column's
 * `sourceRoleId`. Undefined when a role has no column: a fact type that
 * cannot be read back from the table is not named on it.
 */
function relationshipOf(model: OrmModel, ft: FactType, table: Table): Relationship | undefined {
  const roles: RelationshipRole[] = [];
  for (const role of ft.roles) {
    const player = model.getObjectType(role.playerId);
    const columns = table.columns.filter((c) => c.sourceRoleId === role.id).map((c) => c.name);
    if (!player || columns.length === 0) return undefined;
    roles.push({
      name: role.name,
      player: player.name,
      columns,
      ...(player.kind === "value" && player.definition
        ? { valueDefinition: player.definition }
        : {}),
    });
  }
  return {
    factType: ft.name,
    readings: ft.readings.map((r) => r.template),
    ...(ft.definition ? { definition: ft.definition } : {}),
    roles,
  };
}

/** The table and column annotations for a table, keyed as `readAnnotations` keys them. */
export function annotateTable(
  model: OrmModel,
  table: Table,
  uniques: readonly (readonly string[])[] = [],
): { table?: TableAnnotation | FactTableAnnotation; columns: Map<string, ColumnAnnotation>; } {
  const columns = new Map<string, ColumnAnnotation>();
  const source = model.factTypes.find((f) => f.id === table.sourceElementId);
  if (source) {
    const relationship = relationshipOf(model, source, table);
    return relationship
      ? { table: { kind: "factTable", table: table.name, ...relationship }, columns }
      : { columns };
  }
  const entity = model.getObjectType(table.sourceElementId);
  if (!entity || entity.kind !== "entity") return { columns };

  const objectified = model.objectifiedFactTypes.find((o) => o.objectTypeId === entity.id);
  const objectifiedFt = objectified ? model.getFactType(objectified.factTypeId) : undefined;
  const objectifies = objectifiedFt ? relationshipOf(model, objectifiedFt, table) : undefined;
  // The mapper tags each subtype's foreign key with its subtype fact's id.
  const supertypes: SupertypeLink[] = [];
  // v1 states the constraints over subtypes as flags on each link, read
  // only for a table that has one.
  const links = model.subtypeFacts.filter((sf) => sf.subtypeId === entity.id);
  const flags = links.length > 0 ? subtypeFlagsFromConstraints(model.constraints) : undefined;
  for (const sf of links) {
    const supertype = model.getObjectType(sf.supertypeId);
    const fk = table.foreignKeys.find((f) => f.sourceConstraintId === sf.id);
    if (!supertype || !fk) continue;
    supertypes.push({
      entity: supertype.name,
      columns: [...fk.columnNames],
      providesIdentification: sf.providesIdentification,
      isExclusive: flags?.get(sf.id)?.exclusive ?? false,
      isExhaustive: flags?.get(sf.id)?.exhaustive ?? false,
      ...(sf.definingRule ? { definingRule: sf.definingRule } : {}),
    });
  }
  const identifiedBy = identifierColumns(model, entity.id, table);
  const tableAnnotation: TableAnnotation = {
    kind: "table",
    table: table.name,
    entity: entity.name,
    referenceMode: entity.referenceMode,
    ...(entity.definition ? { definition: entity.definition } : {}),
    ...(objectifies ? { objectifies } : {}),
    supertypes,
    ...(identifiedBy && namesIdentifier(identifiedBy, table, supertypes, uniques)
      ? { identifiedBy }
      : {}),
  };

  // A role spread over several columns (a composite foreign key) is one
  // reference, which the importer builds once and reads its line from any
  // of its columns (composite-foreign-key-round-trip.spec.md). The line is
  // written on the first, so naming the fact type on each cannot read as a
  // fact type already taken.
  const lined = new Set<string>();

  for (const column of table.columns) {
    const roleId = column.sourceRoleId;
    if (!roleId || lined.has(roleId)) continue;
    lined.add(roleId);
    const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === roleId));
    if (!ft || ft.arity !== 2) continue;
    const rowRole = ft.roles[0]!.id === roleId ? 0 : 1;
    if (ft.roles[rowRole]!.playerId !== entity.id) continue;
    const players = ft.roles.map((r) => model.getObjectType(r.playerId));
    if (players.some((p) => !p)) continue;
    const other = players[1 - rowRole]!;
    columns.set(column.name, {
      kind: "column",
      table: table.name,
      column: column.name,
      factType: ft.name,
      readings: ft.readings.map((r) => r.template),
      roles: [
        { name: ft.roles[0]!.name, player: players[0]!.name },
        { name: ft.roles[1]!.name, player: players[1]!.name },
      ],
      rowRole,
      ...(ft.definition ? { definition: ft.definition } : {}),
      ...(other.kind === "value" && other.definition ? { valueDefinition: other.definition } : {}),
    });
  }
  return { table: tableAnnotation, columns };
}

/**
 * The table's columns the entity's stored preferred identifier is over,
 * through each column's `sourceRoleId`. A role of the identifier with no
 * column of its own is the far role of a binary the entity plays, whose
 * column the mapper tags with the entity's role: a value column, or a
 * foreign key. Undefined when a role has no column in this table.
 */
function identifierColumns(
  model: OrmModel,
  entityId: string,
  table: Table,
): string[] | undefined {
  const id = model.preferredIdentifierOf(entityId);
  const constraint = id === undefined ? undefined : model.getConstraint(id);
  if (
    constraint?.type !== "internal_uniqueness" && constraint?.type !== "external_uniqueness"
  ) {
    return undefined;
  }
  const columns: string[] = [];
  for (const roleId of constraint.roleIds) {
    let own = table.columns.filter((c) => c.sourceRoleId === roleId);
    if (own.length === 0) {
      const ft = model.factTypes.find((f) => f.arity === 2 && f.roles.some((r) => r.id === roleId));
      const near = ft?.roles.find((r) => r.id !== roleId);
      own = near?.playerId === entityId
        ? table.columns.filter((c) => c.sourceRoleId === near.id)
        : [];
    }
    if (own.length === 0) return undefined;
    for (const c of own) if (!columns.includes(c.name)) columns.push(c.name);
  }
  return columns;
}

/**
 * Whether a table line needs `identifiedBy`, and the import can read it.
 * The key needs no naming, since the import reads it as the identifier,
 * unless an identifying supertype link is the key and is read as that
 * link instead. The columns must be the key or a UNIQUE the dialect
 * wrote: a dialect with no UNIQUE reports the uniqueness as spilled
 * already, and naming its columns would only add a warning.
 */
function namesIdentifier(
  columns: readonly string[],
  table: Table,
  supertypes: readonly SupertypeLink[],
  uniques: readonly (readonly string[])[],
): boolean {
  const key = table.primaryKey.columnNames;
  if (!sameColumns(columns, key)) return uniques.some((u) => sameColumns(u, columns));
  // Only a one-column key gets an identifier beside its link on import.
  return key.length === 1
    && supertypes.some((s) => s.providesIdentification && sameColumns(s.columns, key));
}

/**
 * Whether two column lists name the same columns, in any order. Shared with
 * the import, which asks the same question of the lines this side writes.
 */
export function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((c) => b.includes(c));
}

/**
 * Insert the annotation lines into rendered DDL: a table's line above its
 * `CREATE TABLE`, a column's line above the column. Lines the rendering
 * does not recognize pass through unchanged.
 */
export function injectBarwiseAnnotations(
  ddl: string,
  model: OrmModel,
  schema: RelationalSchema,
  uniques: readonly RoutedUnique[] = [],
): string {
  const result: string[] = [];
  let columns: Map<string, ColumnAnnotation> | undefined;
  for (const line of ddl.split("\n")) {
    const create = CREATE_LINE.exec(line);
    if (create) {
      // A quoted name doubles its quotes; the schema holds it undoubled.
      const name = create[1] ?? create[2]!.replace(/""/g, '"');
      const table = schema.tables.find((t) => t.name === name);
      const annotated = table
        ? annotateTable(
          model,
          table,
          uniques.filter((u) => u.tableName === name).map((u) => u.columns),
        )
        : undefined;
      if (annotated?.table) result.push(renderAnnotation(annotated.table));
      columns = annotated?.columns;
    } else if (columns && line.startsWith(");")) {
      columns = undefined;
    } else if (columns) {
      const name = COLUMN_LINE.exec(line);
      const annotation = name ? columns.get(name[1] ?? name[2]!.replace(/""/g, '"')) : undefined;
      if (annotation) result.push(`  ${renderAnnotation(annotation)}`);
    }
    result.push(line);
  }
  return result.join("\n");
}

/** A table's first line in the DDL renderer: a plain or a quoted name. */
const CREATE_LINE = /^CREATE TABLE (?:([a-z_][a-z0-9_]*)|"((?:[^"]|"")+)") \($/;

/** A column line of the DDL renderer: two spaces, then a plain or a quoted name. */
const COLUMN_LINE = /^ {2}(?:([a-z_][a-z0-9_]*)|"((?:[^"]|"")+)") /;

/** What `readAnnotations` found. */
export interface ReadAnnotations {
  /** By table name, lower case. */
  readonly tables: ReadonlyMap<string, TableAnnotation | FactTableAnnotation>;
  /** By `table.column`, lower case. */
  readonly columns: ReadonlyMap<string, ColumnAnnotation>;
}

/** The key `readAnnotations` files a column annotation under. */
export function columnKey(table: string, column: string): string {
  return `${table}.${column}`.toLowerCase();
}

/**
 * Every annotation line in a DDL file. A line that does not parse, or
 * parses to something else, is named in `warnings` and skipped: the
 * importer then guesses for that table or column, as it does for DDL
 * barwise did not write.
 */
export function readAnnotations(input: string, warnings: string[]): ReadAnnotations {
  const tables = new Map<string, TableAnnotation | FactTableAnnotation>();
  const columns = new Map<string, ColumnAnnotation>();
  for (const raw of input.split("\n")) {
    const line = raw.trim();
    const version = ANY_VERSION.exec(line);
    if (!version) continue;
    if (!line.startsWith(PREFIX)) {
      warnings.push(
        `Annotation version v${version[1]} is not one this importer reads (v1); "${
          line.slice(0, 60)
        }" ignored.`,
      );
      continue;
    }
    let value: unknown;
    try {
      value = JSON.parse(line.slice(PREFIX.length));
    } catch {
      warnings.push(`Annotation "${line.slice(0, 80)}" is not JSON; ignored.`);
      continue;
    }
    if (isTableAnnotation(value)) {
      tables.set(value.table.toLowerCase(), withReadableIdentifier(value, warnings));
    } else if (isFactTableAnnotation(value)) {
      tables.set(value.table.toLowerCase(), value);
    } else if (isColumnAnnotation(value)) columns.set(columnKey(value.table, value.column), value);
    else warnings.push(`Annotation "${line.slice(0, 80)}" has an unknown shape; ignored.`);
  }
  return { tables, columns };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function optionalString(v: unknown): boolean {
  return v === undefined || typeof v === "string";
}

/**
 * A name the model will accept. The JSON shape alone let an empty name or
 * a reading without `{1}` through, and the model's constructor then threw
 * and aborted the whole import over one hand-edited comment (PR #589
 * review); such a line is now unreadable, so its column is guessed.
 */
function isName(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isTableAnnotation(v: unknown): v is TableAnnotation {
  return isRecord(v) && v["kind"] === "table" && isName(v["table"])
    && isName(v["entity"]) && isName(v["referenceMode"])
    && optionalString(v["definition"])
    && (v["objectifies"] === undefined || isRelationship(v["objectifies"]))
    && (v["supertypes"] === undefined
      || Array.isArray(v["supertypes"]) && v["supertypes"].every(isSupertypeLink));
}

/**
 * The line without an `identifiedBy` that is not a list of distinct
 * column names, with a warning. A bad optional field costs only itself:
 * refusing the line would re-guess the entity's name, definition and
 * supertypes as well.
 */
function withReadableIdentifier(line: TableAnnotation, warnings: string[]): TableAnnotation {
  const v: unknown = line.identifiedBy;
  if (
    v === undefined
    || Array.isArray(v) && v.length > 0 && v.every(isName) && new Set(v).size === v.length
  ) {
    return line;
  }
  warnings.push(
    `Table "${line.table}": the annotation's identifiedBy is not a list of distinct column names; `
      + `ignored (annotation-preferred-identifier.spec.md).`,
  );
  const { identifiedBy: _dropped, ...rest } = line;
  return rest;
}

function isSupertypeLink(v: unknown): v is SupertypeLink {
  return isRecord(v) && isName(v["entity"])
    && Array.isArray(v["columns"]) && v["columns"].length > 0 && v["columns"].every(isName)
    && typeof v["providesIdentification"] === "boolean"
    && typeof v["isExclusive"] === "boolean"
    && typeof v["isExhaustive"] === "boolean"
    && (v["definingRule"] === undefined || isDerivationRule(v["definingRule"]));
}

/**
 * Keyed by core's unions, so a kind or storage added there fails to compile
 * here rather than being read as unknown.
 */
const DERIVATION_KINDS: Record<DerivationKind, true> = { derived: true, semiderived: true };
const DERIVATION_STORAGE: Record<DerivationStorage, true> = {
  derive_on_request: true,
  derived_and_stored: true,
};

/**
 * A rule the model can hold. Checking the expression alone let a rule with
 * no kind through, verbalized as derived and written back with none (PR
 * #623 review).
 */
function isDerivationRule(v: unknown): v is DerivationRule {
  return isRecord(v) && typeof v["expression"] === "string"
    && typeof v["kind"] === "string" && Object.hasOwn(DERIVATION_KINDS, v["kind"])
    && (v["storage"] === undefined
      || typeof v["storage"] === "string" && Object.hasOwn(DERIVATION_STORAGE, v["storage"]))
    && (v["isFormal"] === undefined || typeof v["isFormal"] === "boolean");
}

function isFactTableAnnotation(v: unknown): v is FactTableAnnotation {
  return isRecord(v) && v["kind"] === "factTable" && isName(v["table"]) && isRelationship(v);
}

function isRelationship(v: unknown): v is Relationship {
  if (!isRecord(v)) return false;
  const roles = v["roles"];
  const readings = v["readings"];
  if (!Array.isArray(roles) || roles.length < 2) return false;
  return isName(v["factType"]) && optionalString(v["definition"])
    && Array.isArray(readings) && readings.length > 0
    && readings.every((r) =>
      typeof r === "string" && validateReadingTemplate(r, roles.length).length === 0
    )
    && roles.every((r) =>
      isRecord(r) && isName(r["name"]) && isName(r["player"])
      && optionalString(r["valueDefinition"])
      && Array.isArray(r["columns"]) && r["columns"].length > 0 && r["columns"].every(isName)
    );
}

function isColumnAnnotation(v: unknown): v is ColumnAnnotation {
  if (!isRecord(v) || v["kind"] !== "column") return false;
  const roles = v["roles"];
  const readings = v["readings"];
  return isName(v["table"]) && isName(v["column"]) && isName(v["factType"])
    && Array.isArray(readings) && readings.length > 0
    && readings.every((r) => typeof r === "string" && validateReadingTemplate(r, 2).length === 0)
    && Array.isArray(roles) && roles.length === 2
    && roles.every((r) => isRecord(r) && isName(r["name"]) && isName(r["player"]))
    && (v["rowRole"] === 0 || v["rowRole"] === 1)
    && optionalString(v["definition"]) && optionalString(v["valueDefinition"]);
}
