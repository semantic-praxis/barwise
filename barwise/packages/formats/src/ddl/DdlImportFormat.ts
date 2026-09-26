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
} from "@barwise/core";
import { parseSqlDataType } from "@barwise/core/sql";

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

    // Step 1: Create entity types for all tables
    const entityMap = new Map<string, string>(); // table name -> entity type id
    for (const table of tables) {
      const entityName = toPascalCase(table.name);
      const referenceMode = this.inferReferenceMode(table, warnings);

      const entityType = model.addObjectType({
        name: entityName,
        kind: "entity",
        referenceMode,
      });
      entityMap.set(table.name, entityType.id);
    }

    // Step 2: Give each single-column key a typed identifier. Before the
    // ordinary columns, so a key gets its plain name ahead of a non-key
    // column that shares it, as the dbt importer does.
    for (const table of tables) {
      const entity = model.getObjectType(entityMap.get(table.name) ?? "");
      if (entity) this.createKeyIdentifier(model, entity, table, warnings);
    }

    // Step 3: Create value types and fact types for the other columns
    for (const table of tables) {
      const entityId = entityMap.get(table.name);
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
          const referencedEntityId = entityMap.get(fk.referencedTable);
          if (referencedEntityId) {
            this.createForeignKeyFactType(
              model,
              entityType,
              referencedEntityId,
              column,
              fk,
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

    // Match CREATE TABLE statements (case-insensitive, multiline)
    const createTablePattern = /CREATE\s+TABLE\s+(?:"?(\w+)"?)\s*\(([\s\S]*?)\);/gi;
    let match: RegExpExecArray | null;

    while ((match = createTablePattern.exec(input)) !== null) {
      const tableName = match[1]!;
      const tableBody = match[2]!;

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

    // Split by comma, but not commas inside parentheses
    const parts = this.splitTableParts(body);

    for (const part of parts) {
      // A named table constraint reads the same once its name is gone.
      const trimmed = part.trim().replace(/^CONSTRAINT\s+"?\w+"?\s+/i, "");
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

      // A CHECK or a MySQL index definition, not a column named "key".
      if (/^(CHECK\s*\(|(INDEX|KEY)\s+"?\w+"?\s*\()/i.test(trimmed)) {
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

    return {
      name: tableName,
      columns,
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

    for (let i = 0; i < body.length; i++) {
      const char = body[i]!;
      if (char === "(") {
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
    const head = /^"?(\w+)"?\s+/.exec(def);
    const typeMatch = head ? TYPE_PATTERN.exec(def.slice(head[0].length)) : null;
    if (!head || !typeMatch) {
      warnings.push(`Table "${tableName}": could not read column "${def}"; not imported.`);
      return null;
    }
    const name = head[1]!;
    const dataType = typeMatch[0].trim();
    let rest = def.slice(head[0].length + typeMatch[0].length).trim();

    let nullable = true;
    let primaryKey = false;
    let unique = false;
    let references: ParsedColumn["references"];
    while (rest) {
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
        references = { table: clause[1]!, column: clause[2]! };
      }
      rest = rest.slice(clause[0].length).trim();
    }

    return { name, dataType, nullable, primaryKey, unique, ...(references ? { references } : {}) };
  }

  /**
   * Parse column names from a constraint like "PRIMARY KEY (col1, col2)".
   */
  private parseConstraintColumns(constraint: string): string[] {
    const match = /\((.*?)\)/i.exec(constraint);
    if (!match) return [];

    return match[1]!
      .split(",")
      .map((col) => col.trim().replace(/"/g, ""))
      .filter((col) => col.length > 0);
  }

  /**
   * Parse a foreign key constraint.
   */
  private parseForeignKey(constraint: string): ParsedForeignKey | null {
    // Match: FOREIGN KEY (col1, col2) REFERENCES table (ref1, ref2)
    const match = /FOREIGN\s+KEY\s*\((.*?)\)\s*REFERENCES\s+(?:"?(\w+)"?)\s*\((.*?)\)/i.exec(
      constraint,
    );
    if (!match) return null;

    const columns = match[1]!
      .split(",")
      .map((col) => col.trim().replace(/"/g, ""));
    const referencedTable = match[2]!;
    const referencedColumns = match[3]!
      .split(",")
      .map((col) => col.trim().replace(/"/g, ""));

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

    const identifier = this.claimValueType(model, entity, column, "key", table, warnings);
    // Minted, never built from names (importer-role-ids.spec.md).
    const entityRoleId = generateId();
    const valueRoleId = generateId();
    const constraints: Constraint[] = [
      { type: "internal_uniqueness", roleIds: [valueRoleId], isPreferred: true },
      { type: "internal_uniqueness", roleIds: [entityRoleId] },
      { type: "mandatory", roleId: entityRoleId },
    ];
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
  ): ObjectType {
    const dataType = columnDataType(column);
    const candidate = toPascalCase(column.name);
    const claim = claimValueTypeName(model, entity.id, entity.name, candidate, dataType, role);
    if (claim.kind === "share") return claim.valueType;
    if (claim.displaced) {
      warnings.push(
        `Table "${table.name}", column "${column.name}" (${column.dataType}): the name "${candidate}" is `
          + `already held by ${claim.displaced.kind} type "${claim.displaced.name}" with a different type or role; `
          + `created value type "${claim.name}" instead.`,
      );
    }
    return model.addObjectType({ name: claim.name, kind: "value", dataType });
  }

  /**
   * Create a fact type for a foreign key relationship.
   */
  private createForeignKeyFactType(
    model: OrmModel,
    entityType: { readonly id: string; readonly name: string; },
    referencedEntityId: string,
    column: ParsedColumn,
    fk: ParsedForeignKey,
    warnings: string[],
  ): void {
    const referencedEntity = model.getObjectType(referencedEntityId);
    if (!referencedEntity) return;

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
    warnings: string[],
  ): void {
    try {
      const valueType = this.claimValueType(
        model,
        entityType,
        column,
        "attribute",
        table,
        warnings,
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
const TYPE_PATTERN = new RegExp(
  `^(?!${CLAUSE_KEYWORD})[a-z_]\\w*(?:\\s*\\(\\s*\\d+(?:\\s*,\\s*\\d+)?\\s*\\))?`
    + `(?:\\s+(?!${CLAUSE_KEYWORD})[a-z_]\\w*(?:\\s*\\(\\s*\\d+(?:\\s*,\\s*\\d+)?\\s*\\))?)*`,
  "i",
);

/**
 * The column clauses the importer reads, each anchored at the start of
 * what is left. `DEFAULT` is read so it does not end the parse, and not
 * imported: the model has no place for a default.
 */
const COLUMN_CLAUSES: readonly RegExp[] = [
  /^NOT\s+NULL\b/i,
  /^NULL\b/i,
  /^PRIMARY\s+KEY\b/i,
  /^UNIQUE\b/i,
  /^REFERENCES\s+"?(\w+)"?\s*\(\s*"?(\w+)"?\s*\)/i,
  /^DEFAULT\s+(?:'(?:[^']|'')*'|\([^)]*\)|[\w.+-]+(?:\s*\(\s*\))?)/i,
];

/**
 * A column's conceptual data type, with length and scale. "other" is DDL
 * import's explicit policy for a type the shared mapping does not
 * recognize (barwise-865).
 */
function columnDataType(column: ParsedColumn): DataTypeDef {
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
