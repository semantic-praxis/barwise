/**
 * Relational mapper (Rmap).
 *
 * Transforms an ORM conceptual model into a relational schema using
 * standard ORM-to-relational mapping algorithms.
 *
 * Mapping rules:
 * 1. Each independent entity type becomes a table with its reference mode as PK.
 * 2. Binary fact type with single-role uniqueness: FK on the uniqueness side's
 *    table pointing to the other side.
 * 3. Binary fact type with spanning uniqueness (both roles unique): separate
 *    table unless one side is mandatory (then FK absorbed into that side).
 * 4. Unary fact type: boolean column on the player's table.
 * 5. Ternary+ fact types: associative table with composite PK.
 * 6. Value types used as reference modes become PK column types.
 * 7. Value types in non-identifying roles become column types.
 * 8. Subtype facts with identification: subtype table's PK is a FK to the
 *    supertype table (shared PK pattern).
 * 9. Objectified fact types: the objectified entity's table absorbs the
 *    underlying fact type's roles as FK columns, and its PK becomes
 *    the composite of those columns.
 */

import type { FactType } from "../model/FactType.js";
import type { ObjectifiedFactType } from "../model/ObjectifiedFactType.js";
import type { DataTypeDef, ObjectType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { PreferredIdentifierStrategy } from "../model/OrmProject.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
import type {
  Column,
  ForeignKey,
  PrimaryKey,
  RelationalSchema,
  Table,
} from "./RelationalSchema.js";

/**
 * Options for relational mapping.
 */
export interface RelationalMapperOptions {
  /**
   * Default data type strategy for entity primary key columns when no
   * explicit preferred identifier value type is declared.
   *
   * - "integer" -- PK columns default to INTEGER.
   * - "uuid"    -- PK columns default to UUID.
   * - undefined -- falls back to TEXT (legacy behavior).
   */
  readonly preferredIdentifierStrategy?: PreferredIdentifierStrategy;
}

export class RelationalMapper {
  /**
   * Map an ORM model to a relational schema.
   */
  map(model: OrmModel, options?: RelationalMapperOptions): RelationalSchema {
    const fallbackPkType = strategyToSqlType(options?.preferredIdentifierStrategy);
    const associativeTables: MutableTable[] = [];
    const entityTables = new Map<string, MutableTable>();

    // Step 1: Create a table for each entity type.
    for (const ot of model.objectTypes) {
      if (ot.kind === "entity") {
        const pkColName = ot.referenceMode ?? `${toSnake(ot.name)}_id`;
        // Resolve the PK data type from the reference-mode value type.
        const pkDataType = resolveEntityPkType(ot, model, fallbackPkType);
        const table: MutableTable = {
          name: toSnake(ot.name),
          columns: [{ name: pkColName, dataType: pkDataType, nullable: false }],
          primaryKey: { columnNames: [pkColName] },
          foreignKeys: [],
          sourceElementId: ot.id,
        };
        entityTables.set(ot.id, table);
      }
    }

    // Collect fact type ids that are objectified -- they are handled
    // separately in step 2b and should not produce their own mapping.
    const objectifiedFactTypeIds = new Set(
      model.objectifiedFactTypes.map((oft) => oft.factTypeId),
    );

    // Step 2: Process each non-objectified fact type.
    for (const ft of model.factTypes) {
      if (objectifiedFactTypeIds.has(ft.id)) continue;

      if (ft.arity === 1) {
        this.mapUnaryFactType(ft, model, entityTables);
      } else if (ft.arity === 2) {
        this.mapBinaryFactType(ft, model, entityTables, associativeTables);
      } else {
        this.mapNaryFactType(ft, model, entityTables, associativeTables);
      }
    }

    // Step 2b: Process objectified fact types. The objectified entity's
    // table absorbs the underlying fact type's roles as FK columns, and
    // its PK becomes the composite of those columns.
    for (const oft of model.objectifiedFactTypes) {
      this.mapObjectifiedFactType(oft, model, entityTables);
    }

    // Step 3: Process subtype facts.
    for (const sf of model.subtypeFacts) {
      this.mapSubtypeFact(sf, model, entityTables);
    }

    // Collect all tables: entity tables first, then associative tables.
    const allTables: Table[] = [...entityTables.values(), ...associativeTables].map(
      (t) => freezeTable(t),
    );

    return {
      tables: allTables,
      sourceModelId: model.name,
    };
  }

  /**
   * Unary fact type: add a boolean column to the player's table.
   */
  private mapUnaryFactType(
    ft: FactType,
    _model: OrmModel,
    entityTables: Map<string, MutableTable>,
  ): void {
    const role = ft.roles[0]!;
    const table = entityTables.get(role.playerId);
    if (!table) return;

    const colName = toSnake(ft.name);
    table.columns.push({
      name: colName,
      dataType: "BOOLEAN",
      nullable: true,
      sourceRoleId: role.id,
    });
  }

  /**
   * Binary fact type mapping.
   */
  private mapBinaryFactType(
    ft: FactType,
    model: OrmModel,
    entityTables: Map<string, MutableTable>,
    associativeTables: MutableTable[],
  ): void {
    const role1 = ft.roles[0]!;
    const role2 = ft.roles[1]!;
    const player1 = model.getObjectType(role1.playerId);
    const player2 = model.getObjectType(role2.playerId);

    const uniqueness = this.analyzeUniqueness(ft);
    const mandatory = this.analyzeMandatory(ft);

    // Both players are value types: skip (value types don't get their own tables).
    if (player1?.kind === "value" && player2?.kind === "value") return;

    // One player is a value type: add a column to the entity type's table.
    if (player1?.kind === "value" || player2?.kind === "value") {
      this.mapValueTypeColumn(ft, model, entityTables);
      return;
    }

    if (uniqueness.role1Only) {
      // Uniqueness on role1: each player1 instance maps to at most one player2.
      // FK from table1 -> table2.
      this.addForeignKey(
        role1.playerId,
        role2.playerId,
        ft,
        role1.id,
        mandatory.role1,
        entityTables,
        uniqueness.role1Constraint?.id,
      );
    } else if (uniqueness.role2Only) {
      // Uniqueness on role2: FK from table2 -> table1.
      this.addForeignKey(
        role2.playerId,
        role1.playerId,
        ft,
        role2.id,
        mandatory.role2,
        entityTables,
        uniqueness.role2Constraint?.id,
      );
    } else if (uniqueness.both) {
      // Both roles unique (1:1). If one side is mandatory, absorb into that side.
      if (mandatory.role1 && !mandatory.role2) {
        this.addForeignKey(
          role1.playerId,
          role2.playerId,
          ft,
          role1.id,
          true,
          entityTables,
          uniqueness.role1Constraint?.id,
        );
      } else if (mandatory.role2 && !mandatory.role1) {
        this.addForeignKey(
          role2.playerId,
          role1.playerId,
          ft,
          role2.id,
          true,
          entityTables,
          uniqueness.role2Constraint?.id,
        );
      } else {
        // Neither or both mandatory: separate associative table.
        this.createAssociativeTable(ft, model, entityTables, associativeTables);
      }
    } else {
      // No uniqueness (spanning or none): associative table.
      this.createAssociativeTable(ft, model, entityTables, associativeTables);
    }
  }

  /**
   * Ternary+ fact type: always create an associative table.
   */
  private mapNaryFactType(
    ft: FactType,
    model: OrmModel,
    entityTables: Map<string, MutableTable>,
    associativeTables: MutableTable[],
  ): void {
    this.createAssociativeTable(ft, model, entityTables, associativeTables);
  }

  /**
   * When one side of a binary fact type is a value type, add a column
   * to the entity type's table instead of creating a FK.
   */
  private mapValueTypeColumn(
    ft: FactType,
    model: OrmModel,
    entityTables: Map<string, MutableTable>,
  ): void {
    const role1 = ft.roles[0]!;
    const role2 = ft.roles[1]!;
    const player1 = model.getObjectType(role1.playerId);
    const player2 = model.getObjectType(role2.playerId);

    const mandatory = this.analyzeMandatory(ft);

    let entityRole: typeof role1;
    let valuePlayer: ObjectType;
    let isMandatory: boolean;

    if (player1?.kind === "value" && player2?.kind === "entity") {
      entityRole = role2;
      valuePlayer = player1;
      isMandatory = mandatory.role2;
    } else if (player2?.kind === "value" && player1?.kind === "entity") {
      entityRole = role1;
      valuePlayer = player2;
      isMandatory = mandatory.role1;
    } else {
      return;
    }

    const table = entityTables.get(entityRole.playerId);
    if (!table) return;

    const colName = toSnake(valuePlayer.name);
    table.columns.push({
      name: colName,
      dataType: conceptualTypeToSql(valuePlayer.dataType),
      nullable: !isMandatory,
      sourceRoleId: entityRole.id,
      defaultValue: valuePlayer.defaultValue,
    });
  }

  /**
   * Add a FK column to the source table pointing to the target table.
   */
  private addForeignKey(
    sourceEntityId: string,
    targetEntityId: string,
    ft: FactType,
    sourceRoleId: string,
    isMandatory: boolean,
    entityTables: Map<string, MutableTable>,
    sourceConstraintId?: string,
  ): void {
    const sourceTable = entityTables.get(sourceEntityId);
    const targetTable = entityTables.get(targetEntityId);
    if (!sourceTable || !targetTable) return;

    const fkColName = targetTable.primaryKey.columnNames[0]!;
    // FK column type should match the PK column type of the referenced table.
    const pkCol = targetTable.columns.find((c) => c.name === fkColName);
    const fkDataType = pkCol?.dataType ?? "TEXT";
    // Avoid duplicate column names.
    const existingNames = new Set(sourceTable.columns.map((c) => c.name));
    const finalColName = existingNames.has(fkColName)
      ? `fk_${fkColName}`
      : fkColName;

    sourceTable.columns.push({
      name: finalColName,
      dataType: fkDataType,
      nullable: !isMandatory,
      sourceRoleId,
    });

    sourceTable.foreignKeys.push({
      columnNames: [finalColName],
      referencedTable: targetTable.name,
      referencedColumns: [...targetTable.primaryKey.columnNames],
      sourceConstraintId,
    });
  }

  /**
   * Create an associative (join) table for a fact type.
   */
  private createAssociativeTable(
    ft: FactType,
    model: OrmModel,
    entityTables: Map<string, MutableTable>,
    associativeTables: MutableTable[],
  ): void {
    const columns: Column[] = [];
    const pkColNames: string[] = [];
    const foreignKeys: ForeignKey[] = [];

    for (const role of ft.roles) {
      const player = model.getObjectType(role.playerId);
      if (!player || player.kind !== "entity") continue;

      const targetTable = entityTables.get(player.id);
      if (!targetTable) continue;

      const refCol = targetTable.primaryKey.columnNames[0]!;
      const pkCol = targetTable.columns.find((c) => c.name === refCol);
      const colDataType = pkCol?.dataType ?? "TEXT";
      // Disambiguate if the same entity appears in multiple roles.
      const usedNames = new Set(columns.map((c) => c.name));
      const colName = usedNames.has(refCol)
        ? `${toSnake(role.name)}_${refCol}`
        : refCol;

      columns.push({
        name: colName,
        dataType: colDataType,
        nullable: false,
        sourceRoleId: role.id,
      });
      pkColNames.push(colName);

      foreignKeys.push({
        columnNames: [colName],
        referencedTable: targetTable.name,
        referencedColumns: [refCol],
      });
    }

    const table: MutableTable = {
      name: toSnake(ft.name),
      columns,
      primaryKey: { columnNames: pkColNames },
      foreignKeys,
      sourceElementId: ft.id,
    };

    associativeTables.push(table);
  }

  /**
   * Subtype fact mapping: add a FK from the subtype's PK to the
   * supertype's PK. When providesIdentification is true, the subtype
   * table's PK column is also a FK to the supertype table (shared PK).
   */
  private mapSubtypeFact(
    sf: SubtypeFact,
    _model: OrmModel,
    entityTables: Map<string, MutableTable>,
  ): void {
    const subtypeTable = entityTables.get(sf.subtypeId);
    const supertypeTable = entityTables.get(sf.supertypeId);
    if (!subtypeTable || !supertypeTable) return;

    const supertypePkCol = supertypeTable.primaryKey.columnNames[0]!;
    const subtypePkCol = subtypeTable.primaryKey.columnNames[0]!;

    if (sf.providesIdentification) {
      // Shared PK pattern: the subtype's PK IS the FK to the supertype.
      // The PK column already exists. Add a FK constraint on it.
      subtypeTable.foreignKeys.push({
        columnNames: [subtypePkCol],
        referencedTable: supertypeTable.name,
        referencedColumns: [supertypePkCol],
        sourceConstraintId: sf.id,
      });
    } else {
      // Separate identification: add a nullable FK column to the supertype.
      const existingNames = new Set(subtypeTable.columns.map((c) => c.name));
      const fkColName = existingNames.has(supertypePkCol)
        ? `fk_${supertypePkCol}`
        : supertypePkCol;
      const pkCol = supertypeTable.columns.find((c) => c.name === supertypePkCol);
      const fkDataType = pkCol?.dataType ?? "TEXT";

      subtypeTable.columns.push({
        name: fkColName,
        dataType: fkDataType,
        nullable: false,
      });
      subtypeTable.foreignKeys.push({
        columnNames: [fkColName],
        referencedTable: supertypeTable.name,
        referencedColumns: [supertypePkCol],
        sourceConstraintId: sf.id,
      });
    }
  }

  /**
   * Objectified fact type mapping: absorb the underlying fact type's
   * roles into the objectified entity's table as FK columns, and set
   * the PK to the composite of those columns.
   */
  private mapObjectifiedFactType(
    oft: ObjectifiedFactType,
    model: OrmModel,
    entityTables: Map<string, MutableTable>,
  ): void {
    const entityTable = entityTables.get(oft.objectTypeId);
    const factType = model.getFactType(oft.factTypeId);
    if (!entityTable || !factType) return;

    const fkColNames: string[] = [];

    for (const role of factType.roles) {
      const player = model.getObjectType(role.playerId);
      if (!player || player.kind !== "entity") continue;

      const targetTable = entityTables.get(player.id);
      if (!targetTable) continue;

      const refCol = targetTable.primaryKey.columnNames[0]!;
      // Disambiguate if the same entity appears in multiple roles.
      const usedNames = new Set(entityTable.columns.map((c) => c.name));
      const colName = usedNames.has(refCol)
        ? `${toSnake(role.name)}_${refCol}`
        : refCol;

      const pkCol = targetTable.columns.find((c) => c.name === refCol);
      const colDataType = pkCol?.dataType ?? "TEXT";

      entityTable.columns.push({
        name: colName,
        dataType: colDataType,
        nullable: false,
        sourceRoleId: role.id,
      });

      fkColNames.push(colName);

      entityTable.foreignKeys.push({
        columnNames: [colName],
        referencedTable: targetTable.name,
        referencedColumns: [refCol],
        sourceConstraintId: factType.id,
      });
    }

    // Replace the PK with the composite of FK columns.
    if (fkColNames.length > 0) {
      entityTable.primaryKey = { columnNames: fkColNames };
    }
  }

  private analyzeUniqueness(ft: FactType): {
    role1Only: boolean;
    role2Only: boolean;
    both: boolean;
    role1Constraint?: { readonly id: string; };
    role2Constraint?: { readonly id: string; };
  } {
    let role1Unique = false;
    let role2Unique = false;
    let role1Constraint: { readonly id: string; } | undefined;
    let role2Constraint: { readonly id: string; } | undefined;
    const role1Id = ft.roles[0]!.id;
    const role2Id = ft.roles[1]!.id;

    for (const c of ft.constraints) {
      if (c.type === "internal_uniqueness") {
        if (c.roleIds.length === 1 && c.roleIds[0] === role1Id) {
          role1Unique = true;
          if (c.id) {
            role1Constraint = { id: c.id };
          }
        }
        if (c.roleIds.length === 1 && c.roleIds[0] === role2Id) {
          role2Unique = true;
          if (c.id) {
            role2Constraint = { id: c.id };
          }
        }
      }
    }

    return {
      role1Only: role1Unique && !role2Unique,
      role2Only: role2Unique && !role1Unique,
      both: role1Unique && role2Unique,
      role1Constraint,
      role2Constraint,
    };
  }

  private analyzeMandatory(ft: FactType): {
    role1: boolean;
    role2: boolean;
  } {
    let role1Mandatory = false;
    let role2Mandatory = false;
    const role1Id = ft.roles[0]!.id;
    const role2Id = ft.roles[1]!.id;

    for (const c of ft.constraints) {
      if (c.type === "mandatory") {
        if (c.roleId === role1Id) role1Mandatory = true;
        if (c.roleId === role2Id) role2Mandatory = true;
      }
    }

    return { role1: role1Mandatory, role2: role2Mandatory };
  }
}

// -- Helpers --

interface MutableTable {
  name: string;
  columns: Column[];
  primaryKey: PrimaryKey;
  foreignKeys: ForeignKey[];
  sourceElementId: string;
}

function freezeTable(t: MutableTable): Table {
  return {
    name: t.name,
    columns: t.columns,
    primaryKey: t.primaryKey,
    foreignKeys: t.foreignKeys,
    sourceElementId: t.sourceElementId,
  };
}

function toSnake(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

/**
 * Convert a portable DataTypeDef to a SQL type string.
 *
 * Returns parameterized types where applicable (e.g. VARCHAR(50),
 * DECIMAL(10,2)). Falls back to "TEXT" when no DataTypeDef is given.
 */
function conceptualTypeToSql(dataType: DataTypeDef | undefined): string {
  if (!dataType) return "TEXT";

  switch (dataType.name) {
    case "text":
      return dataType.length ? `VARCHAR(${dataType.length})` : "TEXT";
    case "integer":
      return "INTEGER";
    case "decimal":
      if (dataType.length && dataType.scale !== undefined) {
        return `DECIMAL(${dataType.length},${dataType.scale})`;
      }
      if (dataType.length) {
        return `DECIMAL(${dataType.length})`;
      }
      return "DECIMAL";
    case "money":
      return dataType.length
        ? `DECIMAL(${dataType.length},${dataType.scale ?? 2})`
        : "DECIMAL(19,2)";
    case "float":
      return "FLOAT";
    case "boolean":
      return "BOOLEAN";
    case "date":
      return "DATE";
    case "time":
      return "TIME";
    case "datetime":
      return "DATETIME";
    case "timestamp":
      return "TIMESTAMP";
    case "auto_counter":
      return "INTEGER";
    case "binary":
      return dataType.length ? `BINARY(${dataType.length})` : "BLOB";
    case "uuid":
      return "UUID";
    case "other":
      return "TEXT";
    default:
      return "TEXT";
  }
}

/**
 * Convert a PreferredIdentifierStrategy to its SQL type string.
 * Returns "TEXT" when no strategy is set (legacy behavior).
 */
function strategyToSqlType(strategy: PreferredIdentifierStrategy | undefined): string {
  switch (strategy) {
    case "integer":
      return "INTEGER";
    case "uuid":
      return "UUID";
    default:
      return "TEXT";
  }
}

/**
 * Resolve the SQL type for an entity type's primary key column.
 *
 * Strategy:
 * 1. If any fact type has an internal uniqueness constraint with
 *    isPreferred: true that references a role played by this entity,
 *    use the value type from that fact type.
 * 2. Otherwise fall back to the first binary fact type linking this
 *    entity to a value type (the reference-mode heuristic).
 * 3. Falls back to the configured fallbackPkType (derived from the
 *    project's preferredIdentifierStrategy, or "TEXT" when unset).
 */
function resolveEntityPkType(ot: ObjectType, model: OrmModel, fallbackPkType: string): string {
  // Pass 1: look for fact type with isPreferred uniqueness constraint.
  for (const ft of model.factTypes) {
    if (ft.arity !== 2) continue;

    const hasPreferred = ft.constraints.some(
      (c) => c.type === "internal_uniqueness" && c.isPreferred,
    );
    if (!hasPreferred) continue;

    const vp = findValuePlayer(ft, ot, model);
    if (vp) return conceptualTypeToSql(vp.dataType);
  }

  // Pass 2: heuristic -- first binary fact type with a value type.
  for (const ft of model.factTypes) {
    if (ft.arity !== 2) continue;
    const vp = findValuePlayer(ft, ot, model);
    if (vp) return conceptualTypeToSql(vp.dataType);
  }

  return fallbackPkType;
}

/**
 * Given a binary fact type and an entity, return the value type on
 * the other side of the relationship (if any).
 */
function findValuePlayer(
  ft: { roles: readonly { playerId: string; }[]; },
  ot: ObjectType,
  model: OrmModel,
): ObjectType | undefined {
  const role1 = ft.roles[0]!;
  const role2 = ft.roles[1]!;

  if (role1.playerId === ot.id) {
    const other = model.getObjectType(role2.playerId);
    if (other?.kind === "value") return other;
  } else if (role2.playerId === ot.id) {
    const other = model.getObjectType(role1.playerId);
    if (other?.kind === "value") return other;
  }
  return undefined;
}
