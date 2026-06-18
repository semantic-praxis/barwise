/**
 * DDL import format.
 *
 * Parses SQL CREATE TABLE statements into an ORM model. This is a deterministic
 * parser that handles standard ANSI SQL DDL syntax. It infers ORM concepts from
 * relational structure:
 *
 * - Tables become EntityTypes
 * - Columns become binary FactTypes (Entity has ValueType)
 * - PRIMARY KEY becomes uniqueness constraint + preferred identifier
 * - FOREIGN KEY becomes binary FactType between entities
 * - NOT NULL becomes mandatory constraint
 * - UNIQUE becomes uniqueness constraint
 *
 * The parser uses heuristics for naming (SNAKE_CASE -> PascalCase) and type
 * mapping (VARCHAR -> text). The optional LLM enrichment phase (not implemented
 * here) can improve naming and add definitions.
 */

import {
  type ConceptualDataTypeName,
  type ImportFormat,
  type ImportOptions,
  type ImportResult,
  OrmModel,
} from "@barwise/core";

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
  readonly dataType: string;
  readonly nullable: boolean;
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
      const referenceMode = this.inferReferenceMode(table);

      const entityType = model.addObjectType({
        name: entityName,
        kind: "entity",
        referenceMode,
      });
      entityMap.set(table.name, entityType.id);
    }

    // Step 2: Create value types and fact types for columns
    for (const table of tables) {
      const entityId = entityMap.get(table.name);
      if (!entityId) continue;

      const entityType = model.getObjectType(entityId);
      if (!entityType) continue;

      for (const column of table.columns) {
        // Skip primary key columns (they're handled as reference modes)
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
        const table = this.parseTableDefinition(tableName, tableBody);
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
  ): ParsedTable {
    const columns: ParsedColumn[] = [];
    const foreignKeys: ParsedForeignKey[] = [];
    let primaryKey: string[] = [];
    const uniqueConstraints: string[][] = [];

    // Split by comma, but not commas inside parentheses
    const parts = this.splitTableParts(body);

    for (const part of parts) {
      const trimmed = part.trim();

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
        continue;
      }

      // Column definition
      const column = this.parseColumnDefinition(trimmed);
      if (column) {
        columns.push(column);
        // Check for inline PRIMARY KEY
        if (/PRIMARY\s+KEY/i.test(trimmed)) {
          primaryKey = [column.name];
        }
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
   * Parse a column definition like "id INT NOT NULL" or "name VARCHAR(100)".
   */
  private parseColumnDefinition(def: string): ParsedColumn | null {
    // Match: column_name TYPE[(length)] [NOT NULL] [PRIMARY KEY] [UNIQUE]
    const match =
      /^(?:"?(\w+)"?)\s+(\w+)(?:\([\d,\s]+\))?(?:\s+(NOT\s+NULL|NULL|PRIMARY\s+KEY|UNIQUE))*$/i
        .exec(
          def.trim(),
        );
    if (!match) return null;

    const name = match[1]!;
    const dataType = match[2]!;
    const nullable = !/NOT\s+NULL/i.test(def);

    return { name, dataType, nullable };
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
  private inferReferenceMode(table: ParsedTable): string {
    if (table.primaryKey.length === 1) {
      return table.primaryKey[0]!;
    }
    // Composite key or no key: use default
    return `${table.name}_id`;
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
      const role2Id = `${entityType.id}-${verb}-role`;
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
          { name: verb, playerId: referencedEntity.id, id: `${referencedEntity.id}-${verb}-role` },
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
   * Create a fact type for a regular column (Entity has ValueType).
   */
  private createColumnFactType(
    model: OrmModel,
    entityType: { readonly id: string; readonly name: string; },
    column: ParsedColumn,
    table: ParsedTable,
    warnings: string[],
  ): void {
    // Create value type
    const valueTypeName = toPascalCase(column.name);
    const conceptualType = this.mapSqlTypeToConceptual(column.dataType);

    let valueType = model.getObjectTypeByName(valueTypeName);
    if (!valueType) {
      valueType = model.addObjectType({
        name: valueTypeName,
        kind: "value",
        dataType: { name: conceptualType },
      });
    }

    // Create fact type
    const factTypeName = `${entityType.name} has ${valueTypeName}`;

    try {
      const constraints: any[] = [];

      // Check if this column has a UNIQUE constraint
      const isUnique = table.uniqueConstraints.some((cols) => cols.includes(column.name));

      const role0Id = `${valueType.id}-has-role`;
      const role1Id = `${entityType.id}-has-${valueTypeName}-role`;

      // Add uniqueness constraint
      // If unique, make it unique on the entity side
      const uniqueRoleId = isUnique ? role1Id : role0Id;

      constraints.push({
        type: "internal_uniqueness",
        roleIds: [uniqueRoleId],
        isPreferred: false,
      });

      // Add mandatory constraint if NOT NULL
      if (!column.nullable) {
        constraints.push({
          type: "mandatory",
          roleId: role0Id,
        });
      }

      model.addFactType({
        name: factTypeName,
        roles: [
          { name: "has", playerId: valueType.id, id: role0Id },
          { name: `belongs to`, playerId: entityType.id, id: role1Id },
        ],
        readings: [`{0} has {1}`],
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

  /**
   * Map SQL data types to conceptual ORM data types.
   */
  private mapSqlTypeToConceptual(sqlType: string): ConceptualDataTypeName {
    const normalized = sqlType.toUpperCase();

    if (
      /^(VARCHAR|CHAR|TEXT|STRING|NVARCHAR|CHARACTER)/.test(normalized)
    ) {
      return "text";
    }
    if (/^(INT|INTEGER|BIGINT|SMALLINT|TINYINT)/.test(normalized)) {
      return "integer";
    }
    if (/^(DECIMAL|NUMERIC|NUMBER)/.test(normalized)) {
      return "decimal";
    }
    if (/^(REAL|FLOAT|DOUBLE)/.test(normalized)) {
      return "float";
    }
    if (/^(BOOL|BOOLEAN)/.test(normalized)) {
      return "boolean";
    }
    if (/^DATE$/.test(normalized)) {
      return "date";
    }
    if (/^TIME$/.test(normalized)) {
      return "time";
    }
    if (/^(DATETIME|TIMESTAMP)/.test(normalized)) {
      return "datetime";
    }
    if (/^(SERIAL|AUTOINCREMENT|IDENTITY)/.test(normalized)) {
      return "auto_counter";
    }
    if (/^(BLOB|BINARY|BYTEA)/.test(normalized)) {
      return "binary";
    }
    if (normalized.startsWith("UUID")) {
      return "uuid";
    }
    if (normalized.startsWith("MONEY")) {
      return "money";
    }

    return "other";
  }
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
