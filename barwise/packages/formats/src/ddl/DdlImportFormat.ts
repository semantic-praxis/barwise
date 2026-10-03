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
} from "./barwiseAnnotation.js";
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
}

/**
 * DDL import format implementation.
 */
export class DdlImportFormat implements ImportFormat {
  readonly name = "ddl";
  readonly description = "Import SQL DDL (CREATE TABLE statements) into an ORM model";

  parse(input: string, options?: ImportOptions): ImportResult {
    const warnings: string[] = [];
    const modelName = options?.modelName ?? "Imported Model";

    // Parse all CREATE TABLE statements
    const tables = this.parseCreateTables(input, warnings);

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
    // What a barwise export says each table and column came from. A file
    // without them -- another tool's DDL, or --no-annotate -- is read by
    // guessing names from columns, as before (ddl-round-trip-fixed-point
    // spec, workstream 4).
    const annotations = readAnnotations(input, warnings);
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
            a.kind === "table" ? `table "${a.table}"` : `column "${a.table}.${a.column}"`
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
    for (const table of tables) {
      const annotation = annotations.tables.get(tableKey(table.name));
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
      if (entityMap.has(tableKey(table.name)) || model.getObjectTypeByName(entityName)) {
        warnings.push(
          `Table "${table.name}": another table already imports as "${entityName}" `
            + `(two schemas can declare one name); not imported.`,
        );
        continue;
      }
      const referenceMode = annotated && table.primaryKey.length === 1
        ? annotated.referenceMode
        : this.inferReferenceMode(table, warnings);

      const entityType = model.addObjectType({
        name: entityName,
        kind: "entity",
        referenceMode,
        ...(annotated?.definition ? { definition: annotated.definition } : {}),
      });
      entityMap.set(tableKey(table.name), entityType.id);
      accepted.push(table);
    }

    // Step 2: Give each single-column key a typed identifier. Before the
    // ordinary columns, so a key gets its plain name ahead of a non-key
    // column that shares it, as the dbt importer does.
    for (const table of accepted) {
      const entity = model.getObjectType(entityMap.get(tableKey(table.name)) ?? "");
      if (entity) this.createKeyIdentifier(model, entity, table, annotations, warnings);
    }

    // Step 3: Create value types and fact types for the other columns
    for (const table of accepted) {
      const entityId = entityMap.get(tableKey(table.name));
      if (!entityId) continue;

      const entityType = model.getObjectType(entityId);
      if (!entityType) continue;

      for (const cols of table.uniqueConstraints) {
        if (cols.length > 1) {
          warnings.push(
            `Table "${table.name}": UNIQUE (${
              cols.join(", ")
            }) spans several columns and was not imported (barwise-1077).`,
          );
        }
      }

      for (const column of table.columns) {
        // Key columns are the entity's identifier (step 2)
        if (table.primaryKey.includes(column.name)) {
          continue;
        }

        // Check if this column is a foreign key
        const fk = table.foreignKeys.find((fk) => fk.columns.includes(column.name));

        if (fk) {
          // Foreign key: create a fact type between entities
          const referencedEntityId = entityMap.get(tableKey(fk.referencedTable));
          if (referencedEntityId) {
            this.createForeignKeyFactType(
              model,
              entityType,
              referencedEntityId,
              column,
              table,
              annotations,
              warnings,
            );
          }
        } else {
          // Regular column: create value type and fact type
          this.createColumnFactType(
            model,
            entityType,
            column,
            table,
            annotations,
            warnings,
          );
        }
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
    const match = /\((.*?)\)/i.exec(constraint);
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
  private inferReferenceMode(table: ParsedTable, warnings: string[]): string {
    if (table.primaryKey.length === 1) {
      return table.primaryKey[0]!;
    }
    if (table.primaryKey.length > 1) {
      warnings.push(
        `Table "${table.name}": composite PRIMARY KEY (${
          table.primaryKey.join(", ")
        }) was not imported; the entity uses "${table.name}_id" (barwise-1077).`,
      );
    }
    // Composite key or no key: use default
    return `${table.name}_id`;
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
  ): void {
    if (table.primaryKey.length !== 1) return;
    const column = table.columns.find((c) => c.name === table.primaryKey[0]);
    if (!column) {
      warnings.push(
        `Table "${table.name}": PRIMARY KEY names "${table.primaryKey[0]}", which is not a column.`,
      );
      return;
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

    const annotation = this.columnAnnotation(
      model,
      annotations,
      table,
      column,
      entity,
      undefined,
      warnings,
    );
    const identifier = this.claimValueType(
      model,
      entity,
      column,
      "key",
      table,
      warnings,
      annotation,
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
      model.addFactType(
        annotatedFactType(
          annotation,
          entity.id,
          identifier.id,
          entityRoleId,
          valueRoleId,
          constraints,
        ),
      );
      return;
    }
    model.addFactType({
      name: `${entity.name} has ${identifier.name}`,
      roles: [
        { id: entityRoleId, name: "has", playerId: entity.id },
        { id: valueRoleId, name: "is of", playerId: identifier.id },
      ],
      readings: ["{0} has {1}", "{1} is of {0}"],
      constraints,
    });
  }

  /**
   * The value type a column plays, shared or created under core's
   * `claimValueTypeName` -- the rule the dbt importer uses, so a schema's
   * value types do not depend on which importer read it.
   */
  private claimValueType(
    model: OrmModel,
    entity: ObjectType,
    column: ParsedColumn,
    role: "key" | "attribute",
    table: ParsedTable,
    warnings: string[],
    annotation?: ColumnAnnotation,
  ): ObjectType {
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
    if (claim.kind === "share") return claim.valueType;
    if (claim.displaced) {
      warnings.push(
        `Table "${table.name}", column "${column.name}" (${column.dataType}): the name "${candidate}" is `
          + `already held by ${claim.displaced.kind} type "${claim.displaced.name}" with a different type, value constraint or role; `
          + `created value type "${claim.name}" instead.`,
      );
    }
    return model.addObjectType({
      name: claim.name,
      kind: "value",
      dataType,
      ...(column.valueConstraint ? { valueConstraint: column.valueConstraint } : {}),
      ...(annotation?.valueDefinition ? { definition: annotation.valueDefinition } : {}),
    });
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
  ): void {
    const referencedEntity = model.getObjectType(referencedEntityId);
    if (!referencedEntity) return;

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
      model.addFactType(
        annotatedFactType(
          annotation,
          entityType.id,
          referencedEntity.id,
          rowRoleId,
          generateId(),
          constraints,
        ),
      );
      return;
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

      model.addFactType({
        name: factTypeName,
        roles: [
          { name: verb, playerId: referencedEntity.id, id: role1Id },
          { name: `is ${verb} by`, playerId: entityType.id, id: role2Id },
        ],
        readings: [`{0} ${verb} {1}`],
        constraints,
      });
    } catch (err) {
      warnings.push(
        `Failed to create fact type for foreign key ${column.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
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
  ): void {
    try {
      const annotation = this.columnAnnotation(
        model,
        annotations,
        table,
        column,
        entityType,
        undefined,
        warnings,
      );
      const valueType = this.claimValueType(
        model,
        entityType,
        column,
        "attribute",
        table,
        warnings,
        annotation,
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
        model.addFactType(
          annotatedFactType(
            annotation,
            entityType.id,
            valueType.id,
            entityRoleId,
            valueRoleId,
            constraints,
          ),
        );
        return;
      }
      model.addFactType({
        name: `${entityType.name} has ${valueType.name}`,
        roles: [
          { name: "has", playerId: entityType.id, id: entityRoleId },
          { name: "is of", playerId: valueType.id, id: valueRoleId },
        ],
        readings: ["{0} has {1}", "{1} is of {0}"],
        constraints,
      });
    } catch (err) {
      warnings.push(
        `Failed to create fact type for column ${column.name}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
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
const FOREIGN_KEY = new RegExp(
  `FOREIGN\\s+KEY\\s*\\((.*?)\\)\\s*REFERENCES\\s+(${QUALIFIED})\\s*\\((.*?)\\)`,
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
