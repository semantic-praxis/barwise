/**
 * DDL import format.
 *
 * Parses SQL CREATE TABLE statements into an ORM model. This is a deterministic
 * parser that handles standard ANSI SQL DDL syntax. It infers ORM concepts from
 * relational structure:
 *
 * - Tables become EntityTypes
 * - Columns become binary FactTypes (Entity has ValueType), the entity's
 *   role first: uniqueness on the entity's role, NOT NULL a mandatory
 *   entity role, a single-column UNIQUE a uniqueness on the value's role
 * - A single-column PRIMARY KEY becomes an identifier value type with the
 *   key's type, in a preferred identifying binary
 * - FOREIGN KEY (table-level or inline REFERENCES) becomes a binary
 *   FactType between entities
 *
 * What the parser cannot read, it reports as a warning rather than drop
 * silently (ddl-import-fidelity.spec.md).
 *
 * The parser uses heuristics for naming (SNAKE_CASE -> PascalCase) and type
 * mapping (VARCHAR -> text). The optional LLM enrichment phase (not implemented
 * here) can improve naming and add definitions.
 */

import {
  claimValueTypeName,
  type Constraint,
  type DataTypeDef,
  type FactType,
  generateId,
  type ImportFormat,
  type ImportOptions,
  type ImportResult,
  type ObjectType,
  OrmModel,
  type ValueConstraintDef,
} from "@barwise/core";
import { parseSqlDataType } from "@barwise/core/sql";
import {
  type ColumnAnnotation,
  columnKey,
  type ReadAnnotations,
  readAnnotations,
  type Relationship,
  type SupertypeLink,
} from "./barwiseAnnotation.js";
import { bareName, headNoun, sameUpToNumber } from "./nameMatching.js";
import {
  blankComments,
  findCreateTables,
  IDENT,
  identifierList,
  lastPart,
  otherStatements,
  QUALIFIED,
  unquote,
} from "./sqlIdentifiers.js";
import { parseValuePredicate } from "./valuePredicate.js";

/**
 * A parsed CREATE TABLE statement.
 */
interface ParsedTable {
  readonly name: string;
  readonly columns: readonly ParsedColumn[];
  readonly primaryKey: readonly string[];
  readonly uniqueConstraints: readonly (readonly string[])[];
  readonly foreignKeys: readonly ParsedForeignKey[];
}

/**
 * A parsed column definition.
 */
interface ParsedColumn {
  readonly name: string;
  /** The type as written, with any length and scale: `VARCHAR(50)`. */
  readonly dataType: string;
  readonly nullable: boolean;
  /** An inline PRIMARY KEY. */
  readonly primaryKey: boolean;
  /** An inline UNIQUE. */
  readonly unique: boolean;
  /** An inline REFERENCES t (c). */
  readonly references?: { readonly table: string; readonly column: string; };
  /** An inline CHECK the value-predicate grammar reads. */
  readonly valueConstraint?: ValueConstraintDef;
  /** An identity clause: the column's value is generated, so it is an auto_counter. */
  readonly identity: boolean;
}

/**
 * A parsed foreign key constraint.
 */
interface ParsedForeignKey {
  readonly columns: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  /** Added by `--infer-references`, not declared in the DDL. */
  readonly inferred?: true;
}

/**
 * DDL import format implementation.
 */
/**
 * A column's binary fact type and the role its value plays: what an
 * external uniqueness over several columns is made of (ddl-round-trip-
 * fixed-point.spec.md, workstream 6).
 */
interface Binary {
  readonly factType: FactType;
  readonly farRoleId: string;
  /** Every column that stands for the role, when it is more than this one. */
  readonly roleColumns?: readonly string[];
}

export class DdlImportFormat implements ImportFormat {
  readonly name = "ddl";
  readonly description = "Import SQL DDL (CREATE TABLE statements) into an ORM model";

  parse(input: string, options?: ImportOptions): ImportResult {
    const warnings: string[] = [];
    const modelName = options?.modelName ?? "Imported Model";

    // Parse all CREATE TABLE statements
    const parsed = this.parseCreateTables(input, warnings);
    // What a barwise export says each table and column came from. A file
    // without them -- another tool's DDL, or --no-annotate -- is read by
    // guessing names from columns, as before (ddl-round-trip-fixed-point
    // spec, workstream 4). Read before inference, which must not target a
    // table the annotations make a fact table.
    const annotations = readAnnotations(input, warnings);
    // Off unless asked: the flag is the user declaring that the schema
    // names its references after the keys they hold
    // (reference-inference.spec.md).
    const tables = options?.["inferReferences"] === true
      ? inferReferences(parsed, warnings, (t) => annotations.tables.get(tableKey(t))?.kind)
      : parsed;

    if (tables.length === 0) {
      warnings.push("No CREATE TABLE statements found in input");
      return {
        model: new OrmModel({ name: modelName }),
        warnings,
        confidence: "low",
      };
    }

    // Build the ORM model
    const model = new OrmModel({ name: modelName });
    // A line whose table or column is gone -- renamed or dropped by hand --
    // describes nothing in the file; say so rather than drop it unread.
    const present = new Set(tables.flatMap((t) => [
      tableKey(t.name),
      ...t.columns.map((c) => columnKey(t.name, c.name)),
    ]));
    for (const [key, a] of [...annotations.tables, ...annotations.columns]) {
      if (!present.has(key)) {
        warnings.push(
          `The annotation for ${
            a.kind === "column" ? `column "${a.table}.${a.column}"` : `table "${a.table}"`
          } `
            + `matches nothing in the file; ignored.`,
        );
      }
    }

    // Step 1: Create entity types for all tables
    // Keyed by the table's unqualified name in lower case: a foreign key
    // may name its target `CBS.PARTY`, `party` or `[PARTY]`.
    const entityMap = new Map<string, string>(); // table key -> entity type id
    // Only the tables that became entities go on to steps 2 and 3. A table
    // skipped for its name still shares its key with the one that took it,
    // so looking it up by key merged its key and columns into that entity
    // while the warning said it was not imported (PR #577 review).
    const accepted: ParsedTable[] = [];
    // A table barwise exported from a fact type is that fact type, not an
    // entity; it is built once every entity exists (step 1b).
    const factTables: ParsedTable[] = [];
    // A table keyed on two or more foreign keys is an objectified
    // relationship (ddl-round-trip-fixed-point.spec.md, workstream 5).
    const objectifying: ParsedTable[] = [];
    // An unannotated table keyed on several columns reads as the fact type
    // it states (composite-key-tables.spec.md); one that needs no
    // objectifier is built once every entity exists (step 1c).
    const readings = new Map<ParsedTable, CompositeReading>();
    const plainFactTables: ParsedTable[] = [];
    const referenced = new Set(
      tables.flatMap((t) => t.foreignKeys.map((fk) => tableKey(fk.referencedTable))),
    );
    // Every table key a plain fact table took, so a second table with the
    // same unqualified name is skipped with the duplicate warning rather
    // than colliding with the first one's fact type later (PR #621 review).
    const plainKeys = new Set<string>();
    // Every unannotated table's composite reading, decided before any is
    // used, so a reading whose key roles reach back to its own table --
    // directly, or through other composite readings -- can be declined
    // first: it would identify the table's objectifier through itself,
    // which core rejects as an identification cycle (PR #621 review). A
    // declined table keeps today's reading, as requirement 4 keeps any.
    // Keyed by unqualified name, like the entity map, so only the first
    // table of a name is read here: a later one from another schema is
    // the duplicate the loop below skips, and must not overwrite the first
    // one's reading (PR #621 review).
    const firstOfKey = new Map<string, ParsedTable>();
    for (const table of tables) {
      if (!firstOfKey.has(tableKey(table.name))) firstOfKey.set(tableKey(table.name), table);
    }
    const composite = new Map<string, CompositeReading>();
    for (const [key, table] of firstOfKey) {
      if (annotations.tables.get(key) !== undefined) continue;
      const r = compositeReading(table, referenced.has(key));
      if (r) composite.set(key, r);
    }
    const compositeTargets = (key: string): string[] => {
      const table = firstOfKey.get(key)!;
      return composite.get(key)!.roles.flatMap((cols) => {
        const fk = table.foreignKeys.find((f) =>
          f.columns.length === cols.length && f.columns.every((c) => cols.includes(c))
        );
        const target = fk && tableKey(fk.referencedTable);
        return target && composite.has(target) ? [target] : [];
      });
    };
    const cyclic = [...composite.keys()].filter((start) => {
      const seen = new Set<string>();
      const stack = compositeTargets(start);
      while (stack.length > 0) {
        const next = stack.pop()!;
        if (next === start) return true;
        if (seen.has(next)) continue;
        seen.add(next);
        stack.push(...compositeTargets(next));
      }
      return false;
    });
    for (const key of cyclic) {
      composite.delete(key);
      warnings.push(
        `Table "${firstOfKey.get(key)!.name}": its composite key `
          + `references this table again, directly or through other composite keys, so it is `
          + `not read as a fact type; it would be identified through itself.`,
      );
    }
    for (const table of tables) {
      const found = annotations.tables.get(tableKey(table.name));
      if (found?.kind === "factTable") {
        factTables.push(table);
        continue;
      }
      const annotation = found;
      let entityName = toPascalCase(table.name);
      if (annotation && model.getObjectTypeByName(annotation.entity)) {
        warnings.push(
          `Table "${table.name}": its annotation names entity "${annotation.entity}", which another `
            + `table already took; the entity is named from the table instead.`,
        );
      } else if (annotation) {
        entityName = annotation.entity;
      }
      const annotated = annotation?.entity === entityName ? annotation : undefined;
      const reading = annotation === undefined && firstOfKey.get(tableKey(table.name)) === table
        ? composite.get(tableKey(table.name))
        : undefined;
      if (
        plainKeys.has(tableKey(table.name))
        || (reading && !reading.objectified && entityMap.has(tableKey(table.name)))
      ) {
        warnings.push(
          `Table "${table.name}": another table already imports as "${entityName}" `
            + `(two schemas can declare one name); not imported.`,
        );
        continue;
      }
      if (reading) readings.set(table, reading);
      if (reading && !reading.objectified) {
        plainKeys.add(tableKey(table.name));
        plainFactTables.push(table);
        continue;
      }
      if (entityMap.has(tableKey(table.name)) || model.getObjectTypeByName(entityName)) {
        warnings.push(
          `Table "${table.name}": another table already imports as "${entityName}" `
            + `(two schemas can declare one name); not imported.`,
        );
        continue;
      }
      // A table objectifies a relationship when its key is its foreign keys,
      // or when its line says so: an objectified fact type keyed on a value
      // role as well (C01's Admission, on patient and time) has a key with
      // a plain column in it, and is still the relationship (barwise-c65).
      // The older rule (a key made of two or more whole foreign keys) still
      // applies when the composite reading declines a table: requirement 4
      // keeps that table as it was read before (PR #621 review).
      const objectifies = reading !== undefined
        || foreignKeysOfKey(table) !== undefined
        || annotated?.objectifies !== undefined;
      const referenceMode = annotated && (table.primaryKey.length === 1 || objectifies)
        ? annotated.referenceMode
        : objectifies
        ? `${table.name}_id`
        : this.inferReferenceMode(table);
      if (objectifies) objectifying.push(table);

      const entityType = model.addObjectType({
        name: entityName,
        kind: "entity",
        referenceMode,
        ...(annotated?.definition ? { definition: annotated.definition } : {}),
      });
      entityMap.set(tableKey(table.name), entityType.id);
      accepted.push(table);
    }

    // Step 1b: tables that are relationships. A fact-type table whose line
    // no longer matches becomes an entity after all, as it would have been
    // without the line.
    // table key -> the columns a relationship took, with their roles
    const consumed = new Map<string, Map<string, Binary>>();
    for (const table of factTables) {
      const annotation = annotations.tables.get(tableKey(table.name));
      const built = annotation?.kind === "factTable"
        ? this.buildRelationship(model, table, annotation, entityMap, undefined)
        : "it is not a fact-type line";
      if (typeof built !== "string") {
        consumed.set(tableKey(table.name), built);
        continue;
      }
      warnings.push(
        `Table "${table.name}": the annotation no longer matches (${built}); it is imported as an entity.`,
      );
      // From here it is read as if it had no line at all, keyed-on-foreign-
      // keys rule included.
      const keyedOnForeignKeys = foreignKeysOfKey(table) !== undefined;
      const entityType = model.addObjectType({
        name: toPascalCase(table.name),
        kind: "entity",
        referenceMode: keyedOnForeignKeys
          ? `${table.name}_id`
          : this.inferReferenceMode(table),
      });
      entityMap.set(tableKey(table.name), entityType.id);
      accepted.push(table);
      if (keyedOnForeignKeys) objectifying.push(table);
    }
    for (const table of objectifying) {
      const entity = model.getObjectType(entityMap.get(tableKey(table.name)) ?? "");
      if (!entity || entity.kind !== "entity") continue;
      const annotation = annotations.tables.get(tableKey(table.name));
      const declared = annotation?.kind === "table" && annotation.entity === entity.name
        ? annotation.objectifies
        : undefined;
      let built = declared
        ? this.buildRelationship(model, table, declared, entityMap, entity)
        : undefined;
      if (typeof built === "string") {
        warnings.push(
          `Table "${table.name}": the annotation of what it objectifies no longer matches (${built}); `
            + `names are guessed from the table instead.`,
        );
      }
      if (built === undefined || typeof built === "string") {
        const guessed = this.guessedRelationship(model, table, entityMap, readings.get(table));
        built = guessed
          ? this.buildRelationship(model, table, guessed, entityMap, entity, true)
          : "a referenced table is not an entity";
      }
      // A relationship that could not be built leaves the key to step 3,
      // which imports it as an external uniqueness.
      if (typeof built === "string") continue;
      consumed.set(tableKey(table.name), built);
    }

    // Step 1c: tables that read as a fact type no table references and
    // nothing else needs to hold (composite-key-tables.spec.md). One whose
    // relationship cannot be built -- a referenced table imported as no
    // entity -- is an entity after all, read as it was before.
    for (const table of plainFactTables) {
      const guessed = this.guessedRelationship(model, table, entityMap, readings.get(table));
      const built = guessed
        ? this.buildRelationship(model, table, guessed, entityMap, undefined, true)
        : "a referenced table is not an entity";
      if (typeof built !== "string") {
        consumed.set(tableKey(table.name), built);
        continue;
      }
      warnings.push(
        `Table "${table.name}": it reads as a fact type over its key, but ${built}; it is `
          + `imported as an entity.`,
      );
      const keyedOnForeignKeys = foreignKeysOfKey(table) !== undefined;
      const entityType = model.addObjectType({
        name: toPascalCase(table.name),
        kind: "entity",
        referenceMode: keyedOnForeignKeys
          ? `${table.name}_id`
          : this.inferReferenceMode(table),
      });
      entityMap.set(tableKey(table.name), entityType.id);
      accepted.push(table);
    }

    // Each column's binary, by `table.column`: what step 3b's external
    // uniquenesses are built from.
    const binaries = new Map<string, Binary>();

    // Step 2: Give each single-column key a typed identifier. Before the
    // ordinary columns, so a key gets its plain name ahead of a non-key
    // column that shares it, as the dbt importer does. A key that is also
    // a shared-key reference to a table whose kind the name declares is a
    // subtype identified through its supertype instead, with no
    // identifier of its own: keeping both gives the entity two identity
    // sources (key-reference-tables.spec.md, requirements 1-3).
    const byKey = new Map(tables.map((t) => [tableKey(t.name), t]));
    // table key -> the columns a declared subtype link took, which step 3
    // must not read as a relationship as well.
    const subtypeLinks = new Map<string, Set<string>>();
    for (const table of accepted) {
      const entity = model.getObjectType(entityMap.get(tableKey(table.name)) ?? "");
      const found = annotations.tables.get(tableKey(table.name));
      const declared = entity && found?.kind === "table" && found.entity === entity.name
        ? found.supertypes
        : undefined;
      // A table line that carries supertypes says what this table's parents
      // are, empty or not; the naming rule does not second-guess it. Only a
      // list whose every entry no longer matches the DDL falls back to the
      // rule (requirements 4a, 4b).
      if (entity && declared) {
        const kept = this.importSupertypes(model, entity, table, declared, entityMap, warnings);
        if (kept.size > 0 || declared.length === 0) {
          subtypeLinks.set(tableKey(table.name), kept.columns);
          if (kept.identifiedByKey) continue;
          const binary = this.createKeyIdentifier(model, entity, table, annotations, warnings);
          if (binary) binaries.set(columnKey(table.name, table.primaryKey[0]!), binary);
          continue;
        }
      }
      const sub = entity ? subtypeReading(table, byKey) : undefined;
      if (sub && "candidates" in sub) {
        warnings.push(
          `Table "${table.name}": its key references ${
            sub.candidates.map((c) => `"${c}"`).join(", ")
          }, and each would make it a subtype; which is not the DDL's to say, so none is imported `
            + `(key-reference-tables.spec.md).`,
        );
      }
      const parentId = sub && "parent" in sub
        ? entityMap.get(tableKey(sub.parent.name))
        : undefined;
      if (entity && sub && "parent" in sub && parentId && !reaches(model, parentId, entity.id)) {
        model.addSubtypeFact({
          subtypeId: entity.id,
          supertypeId: parentId,
          providesIdentification: true,
        });
        warnings.push(
          `Table "${table.name}": imported as a subtype of "${sub.parent.name}": its name ends in `
            + `"${sub.parent.name}"'s head noun and it repeats none of its columns `
            + `(key-reference-tables.spec.md).`,
        );
        continue;
      }
      const binary = entity
        ? this.createKeyIdentifier(model, entity, table, annotations, warnings)
        : undefined;
      if (binary) binaries.set(columnKey(table.name, table.primaryKey[0]!), binary);
    }

    // Step 3: Create value types and fact types for the other columns
    for (const table of accepted) {
      const entityId = entityMap.get(tableKey(table.name));
      if (!entityId) continue;

      const entityType = model.getObjectType(entityId);
      if (!entityType) continue;

      const taken = consumed.get(tableKey(table.name));
      // A key over several columns that no relationship took is a
      // combination of the entity's attributes: its columns are imported as
      // mandatory attributes, and the combination as an external uniqueness
      // below. They used to be skipped, so the key's values were lost
      // (barwise-1077).
      const compositeKey = table.primaryKey.length > 1 && taken === undefined;

      for (const column of table.columns) {
        // A single key column is the entity's identifier (step 2); a column a
        // relationship took is one of its roles (step 1b).
        if (taken?.has(column.name)) continue;
        const inKey = table.primaryKey.includes(column.name);
        if (inKey && !compositeKey) continue;
        // A table-level PRIMARY KEY makes its columns NOT NULL.
        const read = inKey ? { ...column, nullable: false } : column;

        // A declared subtype link is the subtype fact, not a relationship.
        if (subtypeLinks.get(tableKey(table.name))?.has(column.name.toLowerCase())) continue;

        // Check if this column is a foreign key
        const fk = table.foreignKeys.find((fk) => fk.columns.includes(column.name));

        let binary: Binary | undefined;
        if (fk) {
          // Foreign key: create a fact type between entities
          const referencedEntityId = entityMap.get(tableKey(fk.referencedTable));
          if (referencedEntityId) {
            binary = this.createForeignKeyFactType(
              model,
              entityType,
              referencedEntityId,
              read,
              table,
              annotations,
              warnings,
            );
          } else if (fk.inferred) {
            // Inference predicts which tables become entities; when it
            // predicted wrong (two table names that read as one entity, say)
            // the guess is withdrawn and the column kept, never dropped
            // (PR #628 review).
            warnings.push(
              `Table "${table.name}": the reference inferred for column "${column.name}" has no `
                + `entity to point at ("${fk.referencedTable}" imported as none); it is kept as a `
                + `column instead.`,
            );
            binary = this.createColumnFactType(
              model,
              entityType,
              read,
              table,
              annotations,
              warnings,
            );
          }
        } else {
          // Regular column: create value type and fact type
          binary = this.createColumnFactType(
            model,
            entityType,
            read,
            table,
            annotations,
            warnings,
          );
        }
        if (binary) binaries.set(columnKey(table.name, column.name), binary);
      }

      // Step 3b: a combination of columns that is unique is an external
      // uniqueness over their binaries' other roles, stored on the first
      // column's fact type as the kernels store it -- the shape the export
      // writes a multi-column UNIQUE from (ddl-round-trip-fixed-point
      // spec, workstream 6).
      // A column of the relationship the table objectifies stands for that
      // relationship's role; the columns of a composite foreign key all
      // stand for one role, so a combination naming only some of them
      // constrains less than the role and is refused rather than widened.
      const unexpressible = (cols: readonly string[]): string | undefined => {
        const parts = cols.map((c) => taken?.get(c) ?? binaries.get(columnKey(table.name, c)));
        if (parts.some((p) => p === undefined)) {
          return "spans a column that imported as no fact type of the table's entity";
        }
        const partial = parts.find((p) => p!.roleColumns?.some((c) => !cols.includes(c)));
        return partial
          ? `covers only part of the composite foreign key (${partial.roleColumns!.join(", ")})`
          : undefined;
      };
      const external = (cols: readonly string[]): string | undefined => {
        const reason = unexpressible(cols);
        if (reason) return reason;
        const parts = cols.map((c) => (taken?.get(c) ?? binaries.get(columnKey(table.name, c)))!);
        parts[0]!.factType.addConstraint({
          type: "external_uniqueness",
          roleIds: [...new Set(parts.map((p) => p.farRoleId))],
        });
        return undefined;
      };
      for (const cols of table.uniqueConstraints) {
        if (cols.length < 2) continue;
        // Wholly inside the relationship: step 1b made it an internal
        // uniqueness when it falls on whole roles, and dropped it otherwise.
        const reason = cols.every((c) => taken?.has(c)) ? unexpressible(cols) : external(cols);
        if (reason) {
          warnings.push(
            `Table "${table.name}": UNIQUE (${cols.join(", ")}) ${reason}, and was not imported `
              + `(barwise-1077).`,
          );
        }
      }
      if (compositeKey) {
        const key = table.primaryKey.join(", ");
        warnings.push(
          external(table.primaryKey) === undefined
            ? `Table "${table.name}": composite PRIMARY KEY (${key}) is imported as an external `
              + `uniqueness over its columns; the entity is identified by "${
                entityType.kind === "entity" ? entityType.referenceMode : ""
              }", since an external uniqueness cannot yet be preferred (barwise-ezn).`
            : `Table "${table.name}": composite PRIMARY KEY (${key}) spans a column that imported as `
              + `no fact type of the table's entity, and was not imported (barwise-1077).`,
        );
      }
    }

    return {
      model,
      warnings,
      confidence: "medium",
    };
  }

  /**
   * Parse all CREATE TABLE statements from the input.
   */
  private parseCreateTables(input: string, warnings: string[]): ParsedTable[] {
    const tables: ParsedTable[] = [];
    const { tables: statements, unread } = findCreateTables(input);

    for (const { name: tableName, body: tableBody } of statements) {
      try {
        const table = this.parseTableDefinition(tableName, tableBody, warnings);
        tables.push(table);
      } catch (err) {
        warnings.push(
          `Failed to parse table "${tableName}": ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // Nothing is dropped without a word (sql-import-reads-tables.spec.md, R3).
    for (const name of unread) {
      warnings.push(
        `CREATE TABLE ${name} has no column list (a PARTITION OF, LIKE or AS SELECT table); not imported.`,
      );
    }
    const others = otherStatements(input);
    if (others.size > 0) {
      const list = [...others].map(([kind, n]) => `${kind} (${n})`).join(", ");
      warnings.push(`Statements not imported: ${list}.`);
    }

    return tables;
  }

  /**
   * Parse the body of a CREATE TABLE statement.
   */
  private parseTableDefinition(
    tableName: string,
    body: string,
    warnings: string[],
  ): ParsedTable {
    const columns: ParsedColumn[] = [];
    const foreignKeys: ParsedForeignKey[] = [];
    let primaryKey: string[] = [];
    const uniqueConstraints: string[][] = [];
    const tableChecks: { column: string; constraint: ValueConstraintDef; text: string; }[] = [];

    // Split by comma, but not commas inside parentheses
    const parts = this.splitTableParts(blankComments(body));

    for (const part of parts) {
      // A named table constraint reads the same once its name is gone.
      const trimmed = part.trim().replace(CONSTRAINT_NAME, "");
      if (!trimmed) continue;

      // Primary key constraint
      if (/^PRIMARY\s+KEY\s*\(/i.test(trimmed)) {
        primaryKey = this.parseConstraintColumns(trimmed);
        continue;
      }

      // Unique constraint
      if (/^UNIQUE\s*\(/i.test(trimmed)) {
        uniqueConstraints.push(this.parseConstraintColumns(trimmed));
        continue;
      }

      // Foreign key constraint
      if (/^FOREIGN\s+KEY\s*\(/i.test(trimmed)) {
        const fk = this.parseForeignKey(trimmed);
        if (fk) foreignKeys.push(fk);
        else warnings.push(`Table "${tableName}": could not read "${trimmed}"; not imported.`);
        continue;
      }

      // A CHECK the export's value-predicate grammar wrote is that column's
      // value constraint; any other CHECK, or a MySQL index definition, is
      // named rather than read (ddl-round-trip-fixed-point.spec.md, R2).
      const check = readCheck(trimmed);
      const read = check && check.text.length === trimmed.length
        ? parseValuePredicate(check.predicate)
        : undefined;
      if (read) {
        tableChecks.push({ ...read, text: trimmed });
        continue;
      }
      if (INDEX_OR_CHECK.test(trimmed)) {
        warnings.push(`Table "${tableName}": "${trimmed}" is not imported.`);
        continue;
      }

      // Column definition
      const column = this.parseColumnDefinition(tableName, trimmed, warnings);
      if (!column) continue;
      columns.push(column);
      if (column.primaryKey) primaryKey = [column.name];
      if (column.unique) uniqueConstraints.push([column.name]);
      if (column.references) {
        foreignKeys.push({
          columns: [column.name],
          referencedTable: column.references.table,
          referencedColumns: [column.references.column],
        });
      }
    }

    // A table-level CHECK applies to the column it names, which can be
    // declared before or after it.
    const checked = columns.map((c) => {
      const hit = tableChecks.find((t) => t.column === c.name.toLowerCase());
      return hit ? { ...c, valueConstraint: hit.constraint } : c;
    });
    for (const t of tableChecks) {
      if (!columns.some((c) => c.name.toLowerCase() === t.column)) {
        warnings.push(
          `Table "${tableName}": "${t.text}" names no column of the table; not imported.`,
        );
      }
    }

    return {
      name: tableName,
      columns: checked,
      primaryKey,
      uniqueConstraints,
      foreignKeys,
    };
  }

  /**
   * Split table body into parts, respecting parentheses.
   */
  private splitTableParts(body: string): string[] {
    const parts: string[] = [];
    let current = "";
    let depth = 0;

    // Quote-aware: a comma or parenthesis inside a string literal, as in
    // `DEFAULT 'a, b'`, is text, not structure. A doubled quote ('') toggles
    // twice and so stays inside the string.
    let inString = false;
    for (let i = 0; i < body.length; i++) {
      const char = body[i]!;
      if (char === "'") {
        inString = !inString;
        current += char;
      } else if (inString) {
        current += char;
      } else if (char === "(") {
        depth++;
        current += char;
      } else if (char === ")") {
        depth--;
        current += char;
      } else if (char === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += char;
      }
    }

    if (current.trim()) {
      parts.push(current);
    }

    return parts;
  }

  /**
   * Parse a column definition: a name, the type words up to the first
   * clause keyword with an optional `(length[, scale])`, then any of the
   * clauses in `COLUMN_CLAUSES`.
   *
   * The first version matched one type word and a fixed set of clauses,
   * and returned null for anything else -- `DOUBLE PRECISION`,
   * `CHARACTER VARYING(20)`, a `DEFAULT` -- which the caller skipped
   * without a word. Now a definition with no readable name or type is
   * reported, and a clause the parser does not know is reported while the
   * column is still imported.
   */
  private parseColumnDefinition(
    tableName: string,
    def: string,
    warnings: string[],
  ): ParsedColumn | null {
    const head = COLUMN_NAME.exec(def);
    const typeMatch = head ? TYPE_PATTERN.exec(def.slice(head[0].length)) : null;
    if (!head || !typeMatch) {
      warnings.push(`Table "${tableName}": could not read column "${def}"; not imported.`);
      return null;
    }
    const name = unquote(head[1]!);
    const dataType = typeMatch[0].trim();
    let rest = def.slice(head[0].length + typeMatch[0].length).trim();

    let nullable = true;
    let primaryKey = false;
    let unique = false;
    let references: ParsedColumn["references"];
    let valueConstraint: ValueConstraintDef | undefined;
    let identity = false;
    while (rest) {
      const generated = IDENTITY_CLAUSE.exec(rest);
      if (generated) {
        identity = true;
        rest = rest.slice(generated[0].length).trim();
        continue;
      }
      if (/^DEFAULT\b/i.test(rest)) {
        rest = skipDefaultExpression(rest.slice("DEFAULT".length));
        continue;
      }
      const check = readCheck(rest);
      if (check) {
        const read = parseValuePredicate(check.predicate);
        if (read && read.column === name.toLowerCase()) valueConstraint = read.constraint;
        else {
          warnings.push(`Table "${tableName}", column "${name}": "${check.text}" is not imported.`);
        }
        rest = rest.slice(check.text.length).trim();
        continue;
      }
      const clause = COLUMN_CLAUSES.map((re) => re.exec(rest)).find((m) => m);
      if (!clause) {
        warnings.push(
          `Table "${tableName}", column "${name}": "${rest}" is not imported.`,
        );
        break;
      }
      const text = clause[0].toUpperCase();
      if (text.startsWith("NOT")) nullable = false;
      else if (text.startsWith("PRIMARY")) {
        primaryKey = true;
        nullable = false;
      } else if (text.startsWith("UNIQUE")) unique = true;
      else if (text.startsWith("REFERENCES")) {
        references = { table: lastPart(clause[1]!), column: unquote(clause[2]!) };
      }
      rest = rest.slice(clause[0].length).trim();
    }

    return {
      name,
      dataType,
      nullable,
      primaryKey,
      unique,
      ...(references ? { references } : {}),
      ...(valueConstraint ? { valueConstraint } : {}),
      identity,
    };
  }

  /**
   * Parse column names from a constraint like "PRIMARY KEY (col1, col2)".
   */
  private parseConstraintColumns(constraint: string): string[] {
    const match = new RegExp(`\\(${COLUMN_LIST}\\)`).exec(constraint);
    if (!match) return [];

    return identifierList(match[1]!);
  }

  /**
   * Parse a foreign key constraint.
   */
  private parseForeignKey(constraint: string): ParsedForeignKey | null {
    // Match: FOREIGN KEY (col1, col2) REFERENCES table (ref1, ref2)
    const match = FOREIGN_KEY.exec(constraint);
    if (!match) return null;

    const columns = identifierList(match[1]!);
    const referencedTable = lastPart(match[2]!);
    const referencedColumns = identifierList(match[3]!);

    return { columns, referencedTable, referencedColumns };
  }

  /**
   * Infer the reference mode (primary key column name) for an entity.
   */
  private inferReferenceMode(table: ParsedTable): string {
    if (table.primaryKey.length === 1) {
      return table.primaryKey[0]!;
    }
    // Composite key or no key: use default
    return `${table.name}_id`;
  }

  /**
   * Import the subtype facts a table line declares, each only while the
   * DDL still says it: its columns must be a declared foreign key, in
   * full, to the named supertype's table, as an annotation is used only
   * while it describes the file (ddl-round-trip-fixed-point.spec.md). An
   * entry that fails is dropped alone, with a warning. Each fact is
   * imported with its stored fields, never re-derived from the columns
   * (key-reference-tables.spec.md, requirement 4a).
   */
  private importSupertypes(
    model: OrmModel,
    entity: ObjectType,
    table: ParsedTable,
    declared: readonly SupertypeLink[],
    entityMap: ReadonlyMap<string, string>,
    warnings: string[],
  ): { size: number; columns: Set<string>; identifiedByKey: boolean; } {
    const columns = new Set<string>();
    let size = 0;
    let identifiedByKey = false;
    const lower = (cs: readonly string[]) => cs.map((c) => c.toLowerCase()).sort().join(",");
    for (const link of declared) {
      const supertype = model.getObjectTypeByName(link.entity);
      const fk = supertype && table.foreignKeys.find((f) =>
        lower(f.columns) === lower(link.columns)
        && entityMap.get(tableKey(f.referencedTable)) === supertype.id
      );
      if (!supertype || !fk || reaches(model, supertype.id, entity.id)) {
        warnings.push(
          `Table "${table.name}": its annotation says it is a subtype of "${link.entity}" through `
            + `(${
              link.columns.join(", ")
            }), which is no longer a foreign key to that entity's table; `
            + `that subtype is not imported.`,
        );
        continue;
      }
      // A hand-edited line can name one supertype twice; the model refuses
      // the second fact, which would abort the whole import (PR #623 review).
      if (
        model.subtypeFacts.some((sf) =>
          sf.subtypeId === entity.id && sf.supertypeId === supertype.id
        )
      ) {
        warnings.push(
          `Table "${table.name}": its annotation names "${link.entity}" as a supertype more than `
            + `once; the repeat is ignored.`,
        );
        continue;
      }
      model.addSubtypeFact({
        subtypeId: entity.id,
        supertypeId: supertype.id,
        providesIdentification: link.providesIdentification,
        isExclusive: link.isExclusive,
        isExhaustive: link.isExhaustive,
        ...(link.definingRule ? { definingRule: link.definingRule } : {}),
      });
      size++;
      for (const c of link.columns) columns.add(c.toLowerCase());
      if (link.providesIdentification && lower(link.columns) === lower(table.primaryKey)) {
        identifiedByKey = true;
      }
    }
    return { size, columns, identifiedByKey };
  }

  /**
   * Give a single-column key what a reference mode abbreviates: an
   * identifier value type carrying the key's declared type, and a binary
   * whose value-side uniqueness is preferred. Without it the key's type
   * had nowhere to go, and every export typed the key -- and each foreign
   * key referencing it -- as TEXT (barwise-1058). This is the shape the
   * dbt importer writes, so the relational mapper, the diagram and
   * validation already read it.
   */
  private createKeyIdentifier(
    model: OrmModel,
    entity: ObjectType,
    table: ParsedTable,
    annotations: ReadAnnotations,
    warnings: string[],
  ): Binary | undefined {
    if (table.primaryKey.length !== 1) return undefined;
    const column = table.columns.find((c) => c.name === table.primaryKey[0]);
    if (!column) {
      warnings.push(
        `Table "${table.name}": PRIMARY KEY names "${table.primaryKey[0]}", which is not a column.`,
      );
      return undefined;
    }

    // A key that is also a foreign key identifies this entity by its
    // relationship. The relational mapper has no shape that exports one
    // column as both, short of a subtype, so importing the relationship as
    // well would add a second key column on export. Keep the typed key and
    // say what was not imported (barwise-1078).
    const fk = table.foreignKeys.find((f) => f.columns.includes(column.name));
    if (fk) {
      warnings.push(
        `Table "${table.name}": key column "${column.name}" also references "${fk.referencedTable}"; `
          + `the key is imported, the reference is not (barwise-1078).`,
      );
    }

    const { valueType: identifier, annotation } = this.claimValueType(
      model,
      entity,
      column,
      "key",
      table,
      warnings,
      this.columnAnnotation(model, annotations, table, column, entity, undefined, warnings),
    );
    // Minted, never built from names (importer-role-ids.spec.md).
    const entityRoleId = generateId();
    const valueRoleId = generateId();
    const constraints: Constraint[] = [
      { type: "internal_uniqueness", roleIds: [valueRoleId], isPreferred: true },
      { type: "internal_uniqueness", roleIds: [entityRoleId] },
      { type: "mandatory", roleId: entityRoleId },
    ];
    if (annotation) {
      const factType = model.addFactType(
        annotatedFactType(
          annotation,
          entity.id,
          identifier.id,
          entityRoleId,
          valueRoleId,
          constraints,
        ),
      );
      return { factType, farRoleId: valueRoleId };
    }
    const factType = model.addFactType({
      name: `${entity.name} has ${identifier.name}`,
      roles: [
        { id: entityRoleId, name: "has", playerId: entity.id },
        { id: valueRoleId, name: "is of", playerId: identifier.id },
      ],
      readings: ["{0} has {1}", "{1} is of {0}"],
      constraints,
    });
    return { factType, farRoleId: valueRoleId };
  }

  /**
   * The value type a column plays, shared or created under core's
   * `claimValueTypeName` -- the rule the dbt importer uses, so a schema's
   * value types do not depend on which importer read it.
   *
   * Returns the annotation the caller may still use. An annotation whose
   * value type name is held by something it cannot share is stale: the
   * claim would create a fallback name while the annotated fact type still
   * named the original, so the annotation is set aside and the column
   * claimed as an unannotated one (PR #589 review).
   */
  private claimValueType(
    model: OrmModel,
    entity: ObjectType,
    column: ParsedColumn,
    role: "key" | "attribute",
    table: ParsedTable,
    warnings: string[],
    annotation?: ColumnAnnotation,
  ): { valueType: ObjectType; annotation?: ColumnAnnotation; } {
    const dataType = columnDataType(column);
    const candidate = annotation
      ? annotation.roles[1 - annotation.rowRole]!.player
      : toPascalCase(column.name);
    // The constraint is part of the sharing decision: a constrained column
    // may not share an unconstrained value type, or one with another
    // constraint (PR #580 review). A refusal names the value type below.
    const claim = claimValueTypeName(
      model,
      entity.id,
      entity.name,
      candidate,
      dataType,
      role,
      column.valueConstraint,
      { namedFactType: annotation !== undefined },
    );
    if (claim.kind === "share") return { valueType: claim.valueType, annotation };
    if (annotation && claim.displaced) {
      warnings.push(
        `Table "${table.name}", column "${column.name}": the annotation no longer matches `
          + `("${candidate}" is held by ${claim.displaced.kind} type "${claim.displaced.name}", which it cannot share); `
          + `names are guessed from the column instead.`,
      );
      return this.claimValueType(model, entity, column, role, table, warnings);
    }
    if (claim.displaced) {
      warnings.push(
        `Table "${table.name}", column "${column.name}" (${column.dataType}): the name "${candidate}" is `
          + `already held by ${claim.displaced.kind} type "${claim.displaced.name}" with a different type, value constraint or role; `
          + `created value type "${claim.name}" instead.`,
      );
    }
    const valueType = model.addObjectType({
      name: claim.name,
      kind: "value",
      dataType,
      ...(column.valueConstraint ? { valueConstraint: column.valueConstraint } : {}),
      ...(annotation?.valueDefinition ? { definition: annotation.valueDefinition } : {}),
    });
    return { valueType, annotation };
  }

  /**
   * Create a fact type for a foreign key relationship.
   */
  private createForeignKeyFactType(
    model: OrmModel,
    entityType: { readonly id: string; readonly name: string; },
    referencedEntityId: string,
    column: ParsedColumn,
    table: ParsedTable,
    annotations: ReadAnnotations,
    warnings: string[],
  ): Binary | undefined {
    const referencedEntity = model.getObjectType(referencedEntityId);
    if (!referencedEntity) return undefined;

    const annotation = this.columnAnnotation(
      model,
      annotations,
      table,
      column,
      entityType,
      referencedEntity.name,
      warnings,
    );
    if (annotation) {
      const rowRoleId = generateId();
      const constraints: Constraint[] = [{ type: "internal_uniqueness", roleIds: [rowRoleId] }];
      if (!column.nullable) constraints.push({ type: "mandatory", roleId: rowRoleId });
      const farRoleId = generateId();
      const factType = model.addFactType(
        annotatedFactType(
          annotation,
          entityType.id,
          referencedEntity.id,
          rowRoleId,
          farRoleId,
          constraints,
        ),
      );
      return { factType, farRoleId };
    }

    // Infer a reading pattern from the column name
    const verb = this.inferVerbFromColumnName(column.name, referencedEntity.name);

    const factTypeName = `${entityType.name} ${verb} ${referencedEntity.name}`;

    try {
      const constraints: any[] = [];

      // Add uniqueness constraint on the foreign key side (many-to-one)
      // Role ids are minted, never built from names: `<entity id>-<verb>-role`
      // collided for two foreign keys with the same inferred verb, and
      // `<value type id>-has-role` for every table sharing a column name,
      // producing models that fail validation (importer-role-ids.spec.md).
      const role1Id = generateId();
      const role2Id = generateId();
      constraints.push({
        type: "internal_uniqueness",
        roleIds: [role2Id],
        isPreferred: false,
      });

      // Add mandatory constraint if NOT NULL
      if (!column.nullable) {
        constraints.push({
          type: "mandatory",
          roleId: role2Id,
        });
      }

      const factType = model.addFactType({
        name: factTypeName,
        roles: [
          { name: verb, playerId: referencedEntity.id, id: role1Id },
          { name: `is ${verb} by`, playerId: entityType.id, id: role2Id },
        ],
        readings: [`{0} ${verb} {1}`],
        constraints,
      });
      return { factType, farRoleId: role1Id };
    } catch (err) {
      warnings.push(
        `Failed to create fact type for foreign key ${column.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  }

  /**
   * Create a fact type for a regular column: `<Entity> has <Value>`, the
   * entity's role first.
   *
   * The first version put the value's role first and hung the uniqueness
   * and NOT NULL's mandatory on it, so the model said "each Name has at
   * least one Customers" and the export turned `NOT NULL` into nullable
   * and added `UNIQUE` to columns that had none. A column holds at most
   * one value per row (uniqueness on the entity's role); NOT NULL makes
   * the entity's role mandatory; a single-column UNIQUE says a value
   * belongs to at most one row (uniqueness on the value's role).
   */
  private createColumnFactType(
    model: OrmModel,
    entityType: ObjectType,
    column: ParsedColumn,
    table: ParsedTable,
    annotations: ReadAnnotations,
    warnings: string[],
  ): Binary | undefined {
    try {
      const { valueType, annotation } = this.claimValueType(
        model,
        entityType,
        column,
        "attribute",
        table,
        warnings,
        this.columnAnnotation(model, annotations, table, column, entityType, undefined, warnings),
      );
      // Minted, not built from names; see createForeignKeyFactType.
      const entityRoleId = generateId();
      const valueRoleId = generateId();

      const constraints: Constraint[] = [
        { type: "internal_uniqueness", roleIds: [entityRoleId] },
      ];
      if (!column.nullable) {
        constraints.push({ type: "mandatory", roleId: entityRoleId });
      }
      const isUnique = table.uniqueConstraints.some(
        (cols) => cols.length === 1 && cols[0] === column.name,
      );
      if (isUnique) {
        constraints.push({ type: "internal_uniqueness", roleIds: [valueRoleId] });
      }

      if (annotation) {
        const factType = model.addFactType(
          annotatedFactType(
            annotation,
            entityType.id,
            valueType.id,
            entityRoleId,
            valueRoleId,
            constraints,
          ),
        );
        return { factType, farRoleId: valueRoleId };
      }
      const factType = model.addFactType({
        name: `${entityType.name} has ${valueType.name}`,
        roles: [
          { name: "has", playerId: entityType.id, id: entityRoleId },
          { name: "is of", playerId: valueType.id, id: valueRoleId },
        ],
        readings: ["{0} has {1}", "{1} is of {0}"],
        constraints,
      });
      return { factType, farRoleId: valueRoleId };
    } catch (err) {
      warnings.push(
        `Failed to create fact type for column ${column.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return undefined;
    }
  }

  /**
   * A relationship over a whole table: an annotated fact-type table, what
   * an objectifying table's line says it objectifies, or the shape guessed
   * for a table keyed on its foreign keys. The players and the uniqueness
   * come from the DDL: an entity role's columns must be exactly one of the
   * table's foreign keys, to the table of the named entity; a value role is
   * one column that is no foreign key; the primary key and each `UNIQUE`
   * become a uniqueness over the roles whose columns they span. Returns the
   * columns it took, each with the role it plays, or why it built nothing -- decided before anything is
   * built, so a refusal leaves the model as it was.
   */
  private buildRelationship(
    model: OrmModel,
    table: ParsedTable,
    relationship: Relationship,
    entityMap: ReadonlyMap<string, string>,
    objectifier: ObjectType | undefined,
    guessed = false,
  ): Map<string, Binary> | string {
    if (model.getFactTypeByName(relationship.factType)) {
      return `a fact type named "${relationship.factType}" already exists`;
    }
    const used = new Set<string>();
    const plan: ({ kind: "entity"; id: string; } | { kind: "value"; column: ParsedColumn; })[] = [];
    const plannedValues = new Map<string, ParsedColumn>();
    for (const role of relationship.roles) {
      const missing = role.columns.find((c) => !table.columns.some((col) => col.name === c));
      if (missing) return `it names column "${missing}", which the table does not have`;
      if (role.columns.some((c) => used.has(c))) return "two roles name one column";
      role.columns.forEach((c) => used.add(c));
      const fk = table.foreignKeys.find((f) =>
        f.columns.length === role.columns.length && f.columns.every((c) => role.columns.includes(c))
      );
      if (fk) {
        const player = model.getObjectType(entityMap.get(tableKey(fk.referencedTable)) ?? "");
        if (!player || player.name !== role.player) {
          return `role "${role.name}" references "${
            player?.name ?? fk.referencedTable
          }", not "${role.player}"`;
        }
        plan.push({ kind: "entity", id: player.id });
        continue;
      }
      const column = table.columns.find((c) => c.name === role.columns[0]);
      if (
        role.columns.length !== 1 || !column
        || table.foreignKeys.some((f) => f.columns.includes(column.name))
      ) {
        return `role "${role.name}" is neither one foreign key nor one plain column`;
      }
      // Two roles played by one value type claim it once: the model does
      // not hold the first claim yet, so the second is checked against the
      // first column here. Stricter than the sharing rule (value order
      // counts), which only costs a stale warning on a hand edit.
      const earlier = plannedValues.get(role.player);
      // A guessed name is only the column's, so two columns that name one
      // value type with different types each get their own, as dbt gives
      // them (PR #621 review); an annotation that does so no longer matches.
      if (earlier && !sameColumnValues(earlier, column) && !guessed) {
        return `two roles name "${role.player}" over columns of different types or values`;
      }
      const claim = this.claimRoleValueType(model, objectifier, role.player, column, table);
      // An annotation names the player, so a name another type holds means
      // the line no longer describes the model. A guessed name is only the
      // column's, and takes the renamed value type any column would, as the
      // dbt importer does for the same table (PR #621 review).
      if (claim.kind === "create" && claim.displaced && !guessed) {
        return `"${role.player}" is held by ${claim.displaced.kind} type "${claim.displaced.name}"`;
      }
      plannedValues.set(role.player, column);
      plan.push({ kind: "value", column });
    }
    // A uniqueness falls on whole roles, or ORM has no way to say it here.
    const rolesOver = (cols: readonly string[]): number[] | undefined => {
      const idx = relationship.roles.flatMap((r, i) =>
        r.columns.every((c) => cols.includes(c)) ? [i] : []
      );
      const covered = idx.flatMap((i) => relationship.roles[i]!.columns);
      return covered.length === cols.length && cols.every((c) => covered.includes(c))
        ? idx
        : undefined;
    };
    const keyRoles = table.primaryKey.length > 0 ? rolesOver(table.primaryKey) : undefined;
    if (table.primaryKey.length > 0 && !keyRoles) {
      return "its primary key does not fall on whole roles";
    }

    const roleIds = relationship.roles.map(() => generateId());
    const constraints: Constraint[] = [];
    const uniqueOver = (idx: number[] | undefined) => {
      if (!idx) return;
      const over = idx.map((i) => roleIds[i]!);
      const key = [...over].sort().join();
      const seen = constraints.some((c) =>
        c.type === "internal_uniqueness" && [...c.roleIds].sort().join() === key
      );
      if (!seen) constraints.push({ type: "internal_uniqueness", roleIds: over });
    };
    uniqueOver(keyRoles);
    for (const cols of table.uniqueConstraints) uniqueOver(rolesOver(cols));

    const roles = relationship.roles.map((role, i) => {
      const step = plan[i]!;
      let playerId: string;
      if (step.kind === "entity") {
        playerId = step.id;
      } else {
        const claim = this.claimRoleValueType(model, objectifier, role.player, step.column, table);
        playerId = claim.kind === "share"
          ? claim.valueType.id
          : model.addObjectType({
            name: claim.name,
            kind: "value",
            dataType: columnDataType(step.column),
            ...(step.column.valueConstraint
              ? { valueConstraint: step.column.valueConstraint }
              : {}),
            ...(role.valueDefinition ? { definition: role.valueDefinition } : {}),
          }).id;
      }
      return { id: roleIds[i]!, name: role.name, playerId };
    });
    const factType = model.addFactType({
      name: relationship.factType,
      roles,
      readings: [...relationship.readings],
      constraints,
      ...(relationship.definition ? { definition: relationship.definition } : {}),
    });
    if (objectifier) {
      model.addObjectifiedFactType({ factTypeId: factType.id, objectTypeId: objectifier.id });
    }
    return new Map(
      relationship.roles.flatMap((role, i) =>
        role.columns.map((c): [string, Binary] => [c, {
          factType,
          farRoleId: roleIds[i]!,
          ...(role.columns.length > 1 ? { roleColumns: role.columns } : {}),
        }])
      ),
    );
  }

  /**
   * The sharing rule for a value role of a relationship, which names its
   * own fact type. A name another type holds is prefixed with the
   * objectifier's name, or the table's when nothing objectifies it, which
   * is the name the dbt importer gives the same role (PR #621 review).
   */
  private claimRoleValueType(
    model: OrmModel,
    objectifier: ObjectType | undefined,
    name: string,
    column: ParsedColumn,
    table: ParsedTable,
  ) {
    return claimValueTypeName(
      model,
      objectifier?.id ?? "",
      objectifier?.name ?? toPascalCase(table.name),
      name,
      columnDataType(column),
      "attribute",
      column.valueConstraint,
      { namedFactType: true },
    );
  }

  /**
   * The relationship a table is taken to be when nothing names it: a table
   * keyed on its foreign keys (decided with the requester, 2026-10-07), or
   * any composite-key table the reading in `compositeReading` covers. One
   * role per foreign key or plain column the reading names, each foreign
   * key's role played by its table's entity and each plain column's by a
   * value type named after it; the fact type is named from the table --
   * "Student and Course enrollment", read "{0} and {1} have enrollment".
   * Undefined when a referenced table imported as no entity.
   */
  private guessedRelationship(
    model: OrmModel,
    table: ParsedTable,
    entityMap: ReadonlyMap<string, string>,
    reading?: CompositeReading,
  ): Relationship | undefined {
    const groups = reading?.roles ?? foreignKeysOfKey(table)?.map((fk) => [...fk.columns]);
    if (!groups) return undefined;
    const roles: { name: string; player: string; columns: string[]; }[] = [];
    for (const columns of groups) {
      const fk = table.foreignKeys.find((f) =>
        f.columns.length === columns.length && f.columns.every((c) => columns.includes(c))
      );
      if (fk) {
        const player = model.getObjectType(entityMap.get(tableKey(fk.referencedTable)) ?? "");
        if (!player) return undefined;
        roles.push({ name: "is in", player: player.name, columns });
      } else {
        roles.push({ name: "is in", player: toPascalCase(columns[0]!), columns });
      }
    }
    const words = table.name.replace(/_/g, " ").toLowerCase();
    const list = (items: string[]) =>
      items.length === 2
        ? items.join(" and ")
        : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
    return {
      factType: `${list(roles.map((r) => r.player))} ${words}`,
      readings: [`${list(roles.map((_, i) => `{${i}}`))} have ${words}`],
      roles,
    };
  }

  /**
   * A column's annotation, while it still describes the file: the table's
   * entity plays its row role, the other role is played by `other` when
   * the caller knows it (a foreign key's referenced entity), and no fact
   * type has its name yet. A hand edit can leave an annotation stale, and
   * a stale one is reported and set aside rather than trusted (ddl-round-
   * trip-fixed-point.spec.md, "R4 makes a comment format load-bearing").
   */
  private columnAnnotation(
    model: OrmModel,
    annotations: ReadAnnotations,
    table: ParsedTable,
    column: ParsedColumn,
    rowEntity: { readonly name: string; },
    other: string | undefined,
    warnings: string[],
  ): ColumnAnnotation | undefined {
    const annotation = annotations.columns.get(columnKey(table.name, column.name));
    if (!annotation) return undefined;
    const otherPlayer = annotation.roles[1 - annotation.rowRole]!.player;
    const reason = annotation.roles[annotation.rowRole]!.player !== rowEntity.name
      ? `its row is played by "${
        annotation.roles[annotation.rowRole]!.player
      }", not "${rowEntity.name}"`
      : other !== undefined && otherPlayer !== other
      ? `it references "${otherPlayer}", not "${other}"`
      : model.getFactTypeByName(annotation.factType)
      ? `a fact type named "${annotation.factType}" already exists`
      : undefined;
    if (reason === undefined) return annotation;
    warnings.push(
      `Table "${table.name}", column "${column.name}": the annotation no longer matches (${reason}); `
        + `names are guessed from the column instead.`,
    );
    return undefined;
  }

  /**
   * Infer a verb phrase from a foreign key column name.
   */
  private inferVerbFromColumnName(
    columnName: string,
    referencedEntityName: string,
  ): string {
    // Remove common suffixes like "_id"
    const base = columnName.replace(/_id$/i, "").replace(/_fk$/i, "");

    // Try to extract a verb if the pattern is verb_entity
    // e.g., "assigned_doctor_id" -> "assigned to"
    const match = /^(\w+)_/.exec(base);
    if (match) {
      const verb = match[1]!;
      // Common verb patterns
      if (/^(assigned|created|updated|owned|managed)$/i.test(verb)) {
        return `${verb} to`;
      }
    }

    // Default: use the base as a relationship name
    return base === referencedEntityName.toLowerCase()
      ? "references"
      : toCamelCase(base);
  }
}

/**
 * A column's type: the name, words and optional `(length[, scale])` up to
 * the first clause keyword. `TIMESTAMP(3) WITH TIME ZONE` and
 * `DOUBLE PRECISION` are one type each.
 */
const CLAUSE_KEYWORD =
  "(?:NOT|NULL|PRIMARY|UNIQUE|DEFAULT|REFERENCES|CHECK|CONSTRAINT|COLLATE|GENERATED|AUTO_INCREMENT|AUTOINCREMENT)\\b";
// IDENTITY ends a type only after its first word: `IDENTITY` alone is a
// type name some engines use, and the shared mapping reads it as
// auto_counter; `INTEGER IDENTITY(1,1)` is an INTEGER with a clause.
const TYPE_PATTERN = new RegExp(
  `^(?!${CLAUSE_KEYWORD})[a-z_]\\w*(?:\\s*\\(\\s*\\d+(?:\\s*,\\s*\\d+)?\\s*\\))?`
    + `(?:\\s+(?!${CLAUSE_KEYWORD}|IDENTITY\\b)[a-z_]\\w*(?:\\s*\\(\\s*\\d+(?:\\s*,\\s*\\d+)?\\s*\\))?)*`,
  "i",
);

/** A table's key in the entity map: its unqualified name, in lower case. */
function tableKey(name: string): string {
  return name.toLowerCase();
}

/** Names are read with `IDENT` and `QUALIFIED` (sqlIdentifiers.ts), not `"?(\w+)"?`. */
const CONSTRAINT_NAME = new RegExp(`^CONSTRAINT\\s+${IDENT}\\s+`, "i");
const INDEX_OR_CHECK = new RegExp(`^(CHECK\\s*\\(|(INDEX|KEY)\\s+${IDENT}\\s*\\()`, "i");
const COLUMN_NAME = new RegExp(`^(${IDENT})\\s+`);
/**
 * What is inside a column list's parentheses, a quoted name included: a
 * lazy `(.*?)` stopped at the first `)`, so a key over `"(ambiguous)"`
 * read as `"(ambiguous` and the key was lost.
 */
const COLUMN_LIST = `((?:"[^"]*"|[^)"])*)`;
const FOREIGN_KEY = new RegExp(
  `FOREIGN\\s+KEY\\s*\\(${COLUMN_LIST}\\)\\s*REFERENCES\\s+(${QUALIFIED})\\s*\\(${COLUMN_LIST}\\)`,
  "i",
);

/**
 * The column clauses the importer reads, each anchored at the start of
 * what is left. `DEFAULT` is handled by `skipDefaultExpression`, because
 * its expression has no fixed shape.
 */
/**
 * A column's identity clause, in each dialect's spelling: SQL:2003
 * `GENERATED {ALWAYS | BY DEFAULT} AS IDENTITY [(options)]` (what barwise
 * exports), MySQL `AUTO_INCREMENT`, Snowflake and SQLite
 * `AUTOINCREMENT [(start, step) | START n INCREMENT n]`, and Redshift and
 * SQL Server `IDENTITY [(seed, step)]`. Each used to be reported as "not
 * imported" and ended clause parsing, so a following NOT NULL was lost and
 * an auto_counter read back as integer (barwise-hgr). `GENERATED ALWAYS AS
 * (expr)` is a computed column, not an identity, and does not match.
 */
const IDENTITY_CLAUSE =
  /^(?:GENERATED\s+(?:ALWAYS|BY\s+DEFAULT(?:\s+ON\s+NULL)?)\s+AS\s+IDENTITY(?:\s*\([^()]*\))?|AUTO_INCREMENT\b|AUTOINCREMENT(?:\s*\(\s*\d+\s*,\s*\d+\s*\)|\s+START\s+\d+\s+INCREMENT\s+\d+)?|IDENTITY(?:\s*\(\s*\d+\s*,\s*\d+\s*\))?)(?![\w(])/i;

const COLUMN_CLAUSES: readonly RegExp[] = [
  /^NOT\s+NULL\b/i,
  /^NULL\b/i,
  /^PRIMARY\s+KEY\b/i,
  /^UNIQUE\b/i,
  new RegExp(`^REFERENCES\\s+(${QUALIFIED})\\s*\\(\\s*(${IDENT})\\s*\\)`, "i"),
];

/** A clause keyword that ends a DEFAULT expression at nesting depth 0. */
const AFTER_DEFAULT =
  /^\s+(?:NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE|REFERENCES|CHECK|CONSTRAINT|COLLATE|GENERATED)\b/i;

/**
 * Skip a DEFAULT's expression and return what follows it. The expression
 * runs to the next clause keyword outside any string or parentheses, so
 * `nextval('t_id_seq'::regclass) NOT NULL` keeps its NOT NULL. A regex for
 * the expression's shape stopped inside the call and left the column
 * nullable (review of PR #570). Defaults are read, not imported: the model
 * has no place for one.
 */
function skipDefaultExpression(text: string): string {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (char === "'") inString = !inString;
    else if (inString) continue;
    else if (char === "(") depth++;
    else if (char === ")") depth--;
    else if (depth === 0 && AFTER_DEFAULT.test(text.slice(i))) return text.slice(i).trim();
  }
  return "";
}

/**
 * How an unannotated table keyed on several columns reads
 * (composite-key-tables.spec.md): the roles of the fact type it states --
 * each foreign key inside the key, each plain key column, and the one
 * other column when exactly one remains that is NOT NULL and not itself
 * unique, unless another table references this one -- and whether that fact type needs an entity to objectify it.
 * It does when other columns remain for the entity to hold, when another
 * table references this one, or when the fact type would be a binary over
 * one foreign key and one value, which the relational mapper writes into
 * the entity's table and so could not export back. Undefined for a key
 * without a foreign key in it, or with a foreign key only partly inside.
 */
interface CompositeReading {
  readonly roles: readonly string[][];
  readonly objectified: boolean;
}

function compositeReading(table: ParsedTable, referenced: boolean): CompositeReading | undefined {
  const key = table.primaryKey;
  if (key.length < 2) return undefined;
  const inKey = (c: string) => key.includes(c);
  if (table.foreignKeys.some((f) => f.columns.some(inKey) && !f.columns.every(inKey))) {
    return undefined;
  }
  const keyFks = table.foreignKeys.filter((f) => f.columns.every(inKey));
  if (keyFks.length === 0) return undefined;
  const fkColumns = new Set(keyFks.flatMap((f) => f.columns));
  // Two foreign keys sharing a column cannot both be roles, and which one
  // the key "is" is not the DDL's to say (PR #620 review).
  if (fkColumns.size !== keyFks.reduce((n, f) => n + f.columns.length, 0)) return undefined;
  // Roles follow the primary key's column order, each foreign key placed at
  // its first key column, so the fact type agrees with dbt's reading of the
  // same combination (PR #621 review).
  const keyRoles: string[][] = [];
  for (const c of key) {
    const fk = keyFks.find((f) => f.columns.includes(c));
    if (!fk) keyRoles.push([c]);
    else if (key.find((k) => fk.columns.includes(k)) === c) keyRoles.push([...fk.columns]);
  }
  // A key that is one composite foreign key is one role: the key-is-
  // reference shape (key-reference-tables.spec.md), not a relationship
  // over several (PR #620 review).
  if (keyRoles.length < 2) return undefined;
  // A column unique by itself identifies the objectifying entity; it is
  // never a role, and it needs that entity to exist (C04's line_id).
  const uniqueAlone = (c: string) =>
    table.uniqueConstraints.some((u) => u.length === 1 && u[0] === c);
  const others = table.columns.filter((c) => !inKey(c.name));
  const candidates = others.filter((c) => !uniqueAlone(c.name));
  const lone = candidates.length === 1 ? candidates[0]! : undefined;
  const loneFk = lone && table.foreignKeys.find((f) => f.columns.includes(lone.name));
  // A nullable extra column cannot widen the fact: a row without it still
  // states the key's combination (PR #620 review). Nor can one beside a
  // key another table references: that fact type must be objectified, and
  // one unique over only some of its roles is not one to objectify.
  const extra = !referenced && lone && !lone.nullable
      && (!loneFk || loneFk.columns.length === 1)
    ? [lone.name]
    : undefined;
  const roles = extra ? [...keyRoles, extra] : keyRoles;
  const valueBinary = roles.length === 2
    && roles.filter((r) => table.foreignKeys.some((f) => f.columns.includes(r[0]!))).length === 1;
  const remaining = others.length - (extra ? 1 : 0);
  return { roles, objectified: referenced || remaining > 0 || valueBinary };
}

/**
 * The foreign keys a table's primary key is made of, when it is made of
 * two or more and nothing else: the shape of a relationship's table. A
 * key that is one foreign key identifies an entity by a relationship
 * (barwise-1078), and a key with a plain column is barwise-1077's other
 * half, an external uniqueness.
 */
/**
 * Whether a table keyed on one column that also references another table
 * is a subtype of it (key-reference-tables.spec.md, requirements 1-3).
 * The key column must carry exactly one foreign key, a shared-key one:
 * its source the table's key and its target the other table's whole
 * single-column key. The table's name must end in the other's head noun,
 * up to number, and it must repeat none of the other's non-key columns,
 * which is what separates a subtype (adds columns) from a copy (repeats
 * them). Two or more qualifying parents are reported, not chosen, since
 * taking the first would make the model depend on constraint order. Any
 * other foreign key on the key column leaves today's reading: a subtype
 * that dropped the second reference would lose it.
 */
type SubtypeReading = { readonly parent: ParsedTable; } | {
  readonly candidates: readonly string[];
};

function subtypeReading(
  table: ParsedTable,
  byKey: ReadonlyMap<string, ParsedTable>,
): SubtypeReading | undefined {
  if (table.primaryKey.length !== 1) return undefined;
  // Unquoted SQL names are case-insensitive, so `PRIMARY KEY (subject_id)`
  // and `FOREIGN KEY (SUBJECT_ID)` name one column (PR #623 review).
  const key = table.primaryKey[0]!.toLowerCase();
  const onKey = table.foreignKeys.filter((f) => f.columns.some((c) => c.toLowerCase() === key));
  const qualifying = onKey.flatMap((f) => {
    const parent = byKey.get(tableKey(f.referencedTable));
    if (!parent || parent === table || f.columns.length !== 1) return [];
    if (parent.primaryKey.length !== 1) return [];
    const target = f.referencedColumns.length > 0 ? f.referencedColumns : parent.primaryKey;
    if (target.length !== 1 || target[0]!.toLowerCase() !== parent.primaryKey[0]!.toLowerCase()) {
      return [];
    }
    if (!sameUpToNumber(headNoun(table.name), headNoun(parent.name))) return [];
    const parentKey = parent.primaryKey[0]!.toLowerCase();
    const theirs = new Set(
      parent.columns.map((c) => c.name.toLowerCase()).filter((c) => c !== parentKey),
    );
    if (
      table.columns.some((c) => c.name.toLowerCase() !== key && theirs.has(c.name.toLowerCase()))
    ) {
      return [];
    }
    return [parent];
  });
  if (qualifying.length >= 2) return { candidates: qualifying.map((p) => p.name) };
  if (onKey.length === 1 && qualifying.length === 1) return { parent: qualifying[0]! };
  return undefined;
}

/**
 * `--infer-references` (reference-inference.spec.md): a column with no
 * declared foreign key reads as a reference to the one table it names,
 * as `<key>`, `<table>_<key>` or `<table>_id` -- case and separators
 * ignored, the table in either number by the shared rule -- when that
 * table is not its own, has a single key column, and the declared types
 * have the same conceptual name. Each inference is added as a foreign
 * key, so the rest of the importer reads it as it reads a declared one,
 * and each is warned so it can be checked by eye. Two or more candidates
 * infer nothing. A key column is never inferred, only reported: a guessed
 * reference there would feed the subtype rule a second guess.
 */
function inferReferences(
  tables: readonly ParsedTable[],
  warnings: string[],
  annotatedKind: (table: string) => string | undefined,
): ParsedTable[] {
  // Only a table that becomes an entity can be referenced: the first of
  // its unqualified name (a later one from another schema is skipped as a
  // duplicate, and the reference would resolve to the first, whatever its
  // type), and not one its annotation makes a fact table, which has no
  // entity, so the inferred reference would leave the column with no fact
  // at all (PR #628 review).
  const first = new Map<string, ParsedTable>();
  for (const t of tables) if (!first.has(tableKey(t.name))) first.set(tableKey(t.name), t);
  const isTarget = (u: ParsedTable) =>
    first.get(tableKey(u.name)) === u && annotatedKind(u.name) !== "factTable";
  const squash = (n: string) => bareName(n).replace(/_/g, "");
  // The parser keeps each constraint's own spelling, so `site_id` and a
  // table-level `PRIMARY KEY (SITE_ID)` are one unquoted column; compared
  // exactly, the key exclusion and the declared-reference guard were
  // skipped (PR #628 review).
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  // The conceptual type name, a generated key compared as the integer
  // that refers to it; undefined (unrecognised) never matches.
  const typeOf = (c: ParsedColumn) => {
    const name = parseSqlDataType(c.dataType)?.name;
    return name === "auto_counter" ? "integer" : name;
  };
  const named = (column: string, target: ParsedTable): boolean => {
    const key = squash(target.primaryKey[0]!);
    const x = squash(column);
    const table = squash(target.name);
    if (x === key) return true;
    for (const suffix of [key, "id"]) {
      if (x.length > suffix.length && x.endsWith(suffix)) {
        if (sameUpToNumber(x.slice(0, -suffix.length), table)) return true;
      }
    }
    return false;
  };
  return tables.map((table) => {
    const added: ParsedForeignKey[] = [];
    for (const column of table.columns) {
      if (table.foreignKeys.some((f) => f.columns.some((c) => same(c, column.name)))) continue;
      const type = typeOf(column);
      const candidates = tables.filter((u) => {
        if (u === table || u.primaryKey.length !== 1 || !isTarget(u)) return false;
        if (!named(column.name, u)) return false;
        const key = u.columns.find((c) => same(c.name, u.primaryKey[0]!));
        return type !== undefined && key !== undefined && typeOf(key) === type;
      });
      if (candidates.length === 0) continue;
      const list = candidates.map((u) => `"${u.name}"`).join(", ");
      if (table.primaryKey.some((k) => same(k, column.name))) {
        warnings.push(
          `Table "${table.name}": key column "${column.name}" is named like a reference to ${list}; `
            + `a key column is never inferred (--infer-references).`,
        );
        continue;
      }
      if (candidates.length > 1) {
        warnings.push(
          `Table "${table.name}": column "${column.name}" could reference ${list}; none is `
            + `inferred (--infer-references).`,
        );
        continue;
      }
      const target = candidates[0]!;
      added.push({
        columns: [column.name],
        referencedTable: target.name,
        referencedColumns: [target.primaryKey[0]!],
        inferred: true,
      });
      warnings.push(
        `Table "${table.name}": column "${column.name}" is read as a reference to `
          + `"${target.name}" by its name (--infer-references); check it.`,
      );
    }
    return added.length > 0 ? { ...table, foreignKeys: [...table.foreignKeys, ...added] } : table;
  });
}

/** Whether `from` already reaches `to` through supertypes: a subtype fact to `to` would close a cycle. */
function reaches(model: OrmModel, from: string, to: string): boolean {
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const id = queue.pop()!;
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const sf of model.subtypeFacts) if (sf.subtypeId === id) queue.push(sf.supertypeId);
  }
  return false;
}

function foreignKeysOfKey(table: ParsedTable): ParsedForeignKey[] | undefined {
  const key = table.primaryKey;
  if (key.length < 2) return undefined;
  const fks = table.foreignKeys.filter((f) => f.columns.every((c) => key.includes(c)));
  const covered = fks.flatMap((f) => f.columns);
  if (fks.length < 2 || covered.length !== key.length || !key.every((c) => covered.includes(c))) {
    return undefined;
  }
  return [...fks];
}

/**
 * A binary fact type as its annotation names it: its name, readings,
 * definition and role names, with the roles in the annotation's order.
 * The players and the constraints come from the DDL, through the caller.
 */
function annotatedFactType(
  annotation: ColumnAnnotation,
  rowPlayerId: string,
  otherPlayerId: string,
  rowRoleId: string,
  otherRoleId: string,
  constraints: Constraint[],
) {
  const role = (i: 0 | 1) =>
    i === annotation.rowRole
      ? { id: rowRoleId, name: annotation.roles[i].name, playerId: rowPlayerId }
      : { id: otherRoleId, name: annotation.roles[i].name, playerId: otherPlayerId };
  return {
    name: annotation.factType,
    roles: [role(0), role(1)],
    readings: [...annotation.readings],
    constraints,
    ...(annotation.definition ? { definition: annotation.definition } : {}),
  };
}

/**
 * A column's conceptual data type, with length and scale. "other" is DDL
 * import's explicit policy for a type the shared mapping does not
 * recognize (barwise-865).
 */
/** Whether two columns would make the same value type: data type and value constraint alike. */
function sameColumnValues(a: ParsedColumn, b: ParsedColumn): boolean {
  return JSON.stringify(columnDataType(a)) === JSON.stringify(columnDataType(b))
    && JSON.stringify(a.valueConstraint ?? null) === JSON.stringify(b.valueConstraint ?? null);
}

function columnDataType(column: ParsedColumn): DataTypeDef {
  if (column.identity) return { name: "auto_counter" };
  return parseSqlDataType(column.dataType) ?? { name: "other" };
}

/**
 * Convert snake_case to PascalCase.
 */
function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Convert snake_case to camelCase.
 */
function toCamelCase(str: string): string {
  const parts = str.split("_");
  if (parts.length === 0) return str;

  return (
    parts[0]!.toLowerCase()
    + parts
      .slice(1)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join("")
  );
}

/**
 * A `CHECK (...)` at the start of `text`: the whole clause and the
 * predicate inside it, found by balanced parentheses so an IN list's own
 * parentheses do not end it. Undefined when `text` does not start with one.
 */
function readCheck(text: string): { text: string; predicate: string; } | undefined {
  const head = /^CHECK\s*\(/i.exec(text);
  if (!head) return undefined;
  let depth = 0;
  let inString = false;
  for (let i = head[0].length - 1; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") inString = !inString;
    if (inString) continue;
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) {
      return { text: text.slice(0, i + 1), predicate: text.slice(head[0].length, i) };
    }
  }
  return undefined;
}
