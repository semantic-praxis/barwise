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

import { type OrmModel, validateReadingTemplate } from "@barwise/core";
import type { FactType } from "@barwise/core";
import type { RelationalSchema, Table } from "@barwise/core/mapping";

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
  const tableAnnotation: TableAnnotation = {
    kind: "table",
    table: table.name,
    entity: entity.name,
    referenceMode: entity.referenceMode,
    ...(entity.definition ? { definition: entity.definition } : {}),
    ...(objectifies ? { objectifies } : {}),
  };

  // A role spread over several columns (a composite foreign key) is read
  // one column at a time by the importer, so naming its fact type on each
  // would build it twice. It gets no line.
  const perRole = new Map<string, number>();
  for (const c of table.columns) {
    if (c.sourceRoleId) perRole.set(c.sourceRoleId, (perRole.get(c.sourceRoleId) ?? 0) + 1);
  }

  for (const column of table.columns) {
    const roleId = column.sourceRoleId;
    if (!roleId || perRole.get(roleId) !== 1) continue;
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
 * Insert the annotation lines into rendered DDL: a table's line above its
 * `CREATE TABLE`, a column's line above the column. Lines the rendering
 * does not recognize pass through unchanged.
 */
export function injectBarwiseAnnotations(
  ddl: string,
  model: OrmModel,
  schema: RelationalSchema,
): string {
  const result: string[] = [];
  let columns: Map<string, ColumnAnnotation> | undefined;
  for (const line of ddl.split("\n")) {
    const create = CREATE_LINE.exec(line);
    if (create) {
      // A quoted name doubles its quotes; the schema holds it undoubled.
      const name = create[1] ?? create[2]!.replace(/""/g, '"');
      const table = schema.tables.find((t) => t.name === name);
      const annotated = table ? annotateTable(model, table) : undefined;
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
    if (isTableAnnotation(value) || isFactTableAnnotation(value)) {
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
    && (v["objectifies"] === undefined || isRelationship(v["objectifies"]));
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
