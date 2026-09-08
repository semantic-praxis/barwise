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
import { identificationOrder, preferredIdentifyingBinary } from "../model/identification.js";
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
    const settling = new Map<string, SettlingTable>();

    const objectifiedByType = new Map<string, ObjectifiedFactType>();
    for (const oft of model.objectifiedFactTypes) objectifiedByType.set(oft.objectTypeId, oft);

    // An identification cycle has no settlement order. WS1's structural
    // rule rejects such a model, but `map` must stay total for one that
    // reached here unvalidated, so it falls back to declaration order and
    // gives every entity its reference-mode key -- what the mapper did
    // before it had phases. The output is best-effort; the diagnostic is
    // where the answer lives.
    const settlement = identificationOrder(model);
    const settleable = "order" in settlement;
    const order = settleable
      ? settlement.order
      : model.objectTypes.filter((ot) => ot.kind === "entity").map((ot) => ot.id);

    // A fact type that has become somebody's primary key in phase 0.
    // Phase 2 must not map it again: that is the second column
    // barwise-967 was about, and the mechanism is the one
    // `objectifiedFactTypeIds` already uses for a fact type an
    // objectification consumed.
    const identifyingFactTypeIds = new Set<string>();

    // Phase 0: one table per entity type, carrying its identifying key
    // unless phase 1 is going to replace that key anyway.
    for (const ot of model.objectTypes) {
      if (ot.kind !== "entity") continue;

      // An objectified entity is identified by the fact type it
      // objectifies, so a reference-mode column would end up neither key
      // nor reference (mapper-key-settlement.spec.md, resolved decision).
      // It is still created when absorption cannot produce a key -- a
      // fact type over value types alone absorbs nothing -- because a
      // table with no key at all is worse than a redundant column.
      const absorbing = settleable && this.absorbsAKey(objectifiedByType.get(ot.id), model);

      // The preferred identifying binary IS the identification; a
      // reference mode is shorthand for one. Where a model states both,
      // the preferred identifier is the authority and the reference mode
      // is the guess `completenessWarnings` exists to prevent, so the
      // key is named and typed from the value type that identifies the
      // entity. An entity that absorbs an objectification takes no
      // phase-0 column at all, so its binary is not spent and phase 2
      // maps it as an ordinary column.
      const preferred = preferredIdentifyingBinary(model, ot);
      const pkColName = preferred
        ? toSnake(preferred.valuePlayer.name)
        : ot.referenceMode ?? `${toSnake(ot.name)}_id`;
      const pkDataType = preferred
        ? conceptualTypeToSql(preferred.valuePlayer.dataType)
        : referenceModePkType(ot, model, fallbackPkType);
      if (preferred && !absorbing) identifyingFactTypeIds.add(preferred.factType.id);

      settling.set(ot.id, {
        name: toSnake(ot.name),
        columns: absorbing ? [] : [{
          name: pkColName,
          dataType: pkDataType,
          nullable: false,
          sourceRoleId: preferred?.entityRole.id,
        }],
        primaryKey: { columnNames: absorbing ? [] : [pkColName] },
        foreignKeys: [],
        sourceElementId: ot.id,
      });
    }

    // Phase 1: settle every key, dependencies first, so that nothing in
    // phase 2 can read a key that is still going to change.
    const identifyingSubtypeFacts = new Map<string, SubtypeFact>();
    for (const sf of model.subtypeFacts) {
      if (sf.providesIdentification && !identifyingSubtypeFacts.has(sf.subtypeId)) {
        identifyingSubtypeFacts.set(sf.subtypeId, sf);
      }
    }

    const settledBySubtypeFact = new Set<string>();
    for (const entityId of order) {
      const oft = objectifiedByType.get(entityId);
      if (settleable && this.absorbsAKey(oft, model)) {
        this.settleObjectifiedKey(oft!, model, settling);
        // An entity that both objectifies a fact type and is an
        // identified subtype declares its identity twice. Objectification
        // wins, being the more specific statement, and the subtype fact
        // becomes an ordinary foreign key in phase 2. That is what fixes
        // barwise-965: the subtype arm's shared key starts from the
        // subtype's own key, and dual identification was the only way for
        // that key to be composite by the time it ran.
        continue;
      }
      const sf = identifyingSubtypeFacts.get(entityId);
      if (sf) {
        this.settleSubtypeKey(sf, settling);
        settledBySubtypeFact.add(sf.id);
      }
    }

    // Phase 2: every key is final, so a foreign key built here names one
    // that will not move under it.
    const entityTables = new Map<string, MutableTable>(settling);

    const objectifiedFactTypeIds = new Set(
      model.objectifiedFactTypes.map((oft) => oft.factTypeId),
    );

    for (const ft of model.factTypes) {
      if (objectifiedFactTypeIds.has(ft.id)) continue;
      if (identifyingFactTypeIds.has(ft.id)) continue;

      if (ft.arity === 1) {
        this.mapUnaryFactType(ft, model, entityTables);
      } else if (ft.arity === 2) {
        this.mapBinaryFactType(ft, model, entityTables, associativeTables);
      } else {
        this.mapNaryFactType(ft, model, entityTables, associativeTables);
      }
    }

    for (const sf of model.subtypeFacts) {
      if (settledBySubtypeFact.has(sf.id)) continue;
      this.addSubtypeForeignKey(sf, entityTables);
    }

    const allTables: Table[] = [...entityTables.values(), ...associativeTables].map(
      (t) => freezeTable(t),
    );

    return {
      tables: allTables,
      sourceModelId: model.name,
    };
  }

  /**
   * Whether absorbing this objectification would yield a key at all.
   * A fact type over value types alone contributes no foreign key
   * columns, so there would be nothing for the key to be.
   */
  private absorbsAKey(oft: ObjectifiedFactType | undefined, model: OrmModel): boolean {
    if (!oft) return false;
    const factType = model.getFactType(oft.factTypeId);
    if (!factType) return false;
    return factType.roles.some((role) => model.getObjectType(role.playerId)?.kind === "entity");
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

    pushColumn(table.columns, {
      name: toSnake(ft.name),
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

    pushColumn(table.columns, {
      name: toSnake(valuePlayer.name),
      dataType: conceptualTypeToSql(valuePlayer.dataType),
      nullable: !isMandatory,
      sourceRoleId: entityRole.id,
      defaultValue: valuePlayer.defaultValue,
      // The entity-side role name, so "Patient has MedicalRecordNumber"
      // over an entity already keyed on medical_record_number gives
      // has_medical_record_number rather than a doubled mouthful. Two
      // fact types can share a role name, and the numeric tail in
      // pushColumn covers that.
    }, `${toSnake(entityRole.name)}_${toSnake(valuePlayer.name)}`);
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

    const colNames = this.appendForeignKeyColumns(
      sourceTable.columns,
      targetTable,
      !isMandatory,
      sourceRoleId,
      (pkColName) => `fk_${pkColName}`,
    );

    sourceTable.foreignKeys.push({
      columnNames: colNames,
      referencedTable: targetTable.name,
      referencedColumns: [...targetTable.primaryKey.columnNames],
      sourceConstraintId,
    });
  }

  /**
   * Add one column per column of the target table's primary key to
   * `sourceColumns`, disambiguated against its existing names, and
   * return the new columns' names in the same order as the target's
   * PK. A target with a composite PK (an objectified entity whose PK
   * is the composite of its underlying fact type's role columns)
   * yields one column per PK part, so the FK the caller builds from
   * the returned names can reference every part instead of silently
   * truncating to the first (barwise-931).
   */
  private appendForeignKeyColumns(
    sourceColumns: Column[],
    targetTable: MutableTable,
    nullable: boolean,
    sourceRoleId: string | undefined,
    disambiguate: (pkColName: string) => string,
  ): string[] {
    const localNames: string[] = [];
    for (const pkColName of targetTable.primaryKey.columnNames) {
      const pkCol = targetTable.columns.find((c) => c.name === pkColName);
      localNames.push(pushColumn(sourceColumns, {
        name: pkColName,
        dataType: pkCol?.dataType ?? "TEXT",
        nullable,
        sourceRoleId,
      }, disambiguate(pkColName)));
    }
    return localNames;
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

      // Disambiguate if the same entity appears in multiple roles.
      const colNames = this.appendForeignKeyColumns(
        columns,
        targetTable,
        false,
        role.id,
        (pkColName) => `${toSnake(role.name)}_${pkColName}`,
      );
      pkColNames.push(...colNames);

      foreignKeys.push({
        columnNames: colNames,
        referencedTable: targetTable.name,
        referencedColumns: [...targetTable.primaryKey.columnNames],
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
   * Phase 1: an identified subtype's key mirrors its supertype's.
   *
   * The shared-key pattern: the subtype's own first key column doubles
   * as the first component of a foreign key to the supertype, and one
   * column is added per further supertype key column so the two keys
   * have the same arity (barwise-931).
   *
   * The subtype's own key is single-column whenever this runs. Phase 0
   * gives every entity one reference-mode column, and the only thing
   * that makes a key composite is absorbing an objectification -- which
   * `map` takes in preference to this, so an entity reaching here has
   * not absorbed one. That is what stops the first column being taken
   * and the rest silently dropped (barwise-965).
   */
  private settleSubtypeKey(
    sf: SubtypeFact,
    tables: Map<string, SettlingTable>,
  ): void {
    const subtypeTable = tables.get(sf.subtypeId);
    const supertypeTable = tables.get(sf.supertypeId);
    if (!subtypeTable || !supertypeTable) return;

    const [firstSupertypeCol, ...restSupertypeCols] = supertypeTable.primaryKey.columnNames;
    if (firstSupertypeCol === undefined) return;

    const ownKey = subtypeTable.primaryKey.columnNames;
    if (ownKey.length !== 1) return; // see the comment above: unreachable by construction

    const sharedCols = [ownKey[0]!];
    for (const supertypeCol of restSupertypeCols) {
      const pkCol = supertypeTable.columns.find((c) => c.name === supertypeCol);
      sharedCols.push(pushColumn(subtypeTable.columns, {
        name: supertypeCol,
        dataType: pkCol?.dataType ?? "TEXT",
        nullable: false,
      }, `fk_${supertypeCol}`));
    }
    subtypeTable.primaryKey = { columnNames: sharedCols };

    subtypeTable.foreignKeys.push({
      columnNames: sharedCols,
      referencedTable: supertypeTable.name,
      referencedColumns: [firstSupertypeCol, ...restSupertypeCols],
      sourceConstraintId: sf.id,
    });
  }

  /**
   * Phase 2: a subtype fact that does not identify its subtype, or one
   * whose subtype was identified by an objectification instead, becomes
   * an ordinary foreign key -- one nullable column per supertype key
   * column, added against a key that can no longer change.
   */
  private addSubtypeForeignKey(
    sf: SubtypeFact,
    entityTables: Map<string, MutableTable>,
  ): void {
    const subtypeTable = entityTables.get(sf.subtypeId);
    const supertypeTable = entityTables.get(sf.supertypeId);
    if (!subtypeTable || !supertypeTable) return;

    const colNames = this.appendForeignKeyColumns(
      subtypeTable.columns,
      supertypeTable,
      false,
      undefined,
      (pkColName) => `fk_${pkColName}`,
    );
    subtypeTable.foreignKeys.push({
      columnNames: colNames,
      referencedTable: supertypeTable.name,
      referencedColumns: [...supertypeTable.primaryKey.columnNames],
      sourceConstraintId: sf.id,
    });
  }

  /**
   * Phase 1: an objectified entity's key is the composite of the columns
   * absorbed from its fact type's entity players.
   *
   * Each absorbed column mirrors a column of that player's key, which
   * the settlement order guarantees is already final -- so the foreign
   * key this pushes names a key that will not move under it, which is
   * the whole point of the phase split (barwise-963).
   */
  private settleObjectifiedKey(
    oft: ObjectifiedFactType,
    model: OrmModel,
    tables: Map<string, SettlingTable>,
  ): void {
    const entityTable = tables.get(oft.objectTypeId);
    const factType = model.getFactType(oft.factTypeId);
    if (!entityTable || !factType) return;

    const fkColNames: string[] = [];

    for (const role of factType.roles) {
      const player = model.getObjectType(role.playerId);
      if (!player || player.kind !== "entity") continue;

      const targetTable = tables.get(player.id);
      if (!targetTable) continue;

      // Disambiguate if the same entity appears in multiple roles.
      const colNames = this.appendForeignKeyColumns(
        entityTable.columns,
        targetTable,
        false,
        role.id,
        (pkColName) => `${toSnake(role.name)}_${pkColName}`,
      );
      fkColNames.push(...colNames);

      entityTable.foreignKeys.push({
        columnNames: colNames,
        referencedTable: targetTable.name,
        referencedColumns: [...targetTable.primaryKey.columnNames],
        sourceConstraintId: factType.id,
      });
    }

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

/**
 * A table under construction. Phase 2 may append columns and foreign
 * keys; only phase 1 may set `primaryKey`, which is what `SettlingTable`
 * below expresses and this type withholds.
 *
 * Four defects came from a mutable key read before it was final
 * (barwise-931, -963, -965, and the identification cycles WS1 rejects).
 * Making the field readonly here is the guard: a future step that wants
 * to rewrite a key fails to compile rather than silently invalidating
 * every foreign key already built against it.
 */
interface MutableTable {
  name: string;
  columns: Column[];
  readonly primaryKey: PrimaryKey;
  foreignKeys: ForeignKey[];
  sourceElementId: string;
}

/** The same table during phase 1, where the key is still being decided. */
type SettlingTable = Omit<MutableTable, "primaryKey"> & { primaryKey: PrimaryKey; };

function freezeTable(t: MutableTable): Table {
  return {
    name: t.name,
    columns: t.columns,
    primaryKey: t.primaryKey,
    foreignKeys: t.foreignKeys,
    sourceElementId: t.sourceElementId,
  };
}

/**
 * Append a column under a name no other column in the table already has,
 * and return the name it got.
 *
 * Four sites used to do this by hand and three of them got it wrong in
 * the same way: two pushed a derived name with no check at all (a second
 * fact type between the same entity and value type produced a second
 * column of the same name, and the table could not be created), and the
 * two that did check fell back to a single alternative that could itself
 * be taken. The numeric tail is unbounded so the function is total. A
 * name that is free is returned unchanged, and an `alternative` that is
 * free is preferred over a suffix, so a schema with no collision maps
 * exactly as it did before (barwise-961).
 */
function pushColumn(columns: Column[], column: Column, alternative?: string): string {
  const taken = new Set(columns.map((c) => c.name));
  let name = column.name;
  if (taken.has(name)) {
    const stem = alternative ?? name;
    name = stem;
    for (let i = 2; taken.has(name); i += 1) name = `${stem}_${i}`;
  }
  columns.push({ ...column, name });
  return name;
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
 * Only for an entity with NO preferred identifying binary. The
 * preferred case is answered by `preferredIdentifyingBinary`, which
 * returns the fact type rather than just its type -- this used to have
 * a first pass that found the same fact type, took its data type, and
 * discarded the fact type, which is how the same identification got
 * mapped twice (barwise-967).
 *
 * Strategy:
 * 1. The first binary fact type linking this entity to a value type
 *    (the reference-mode heuristic).
 * 2. Otherwise the configured fallbackPkType (derived from the
 *    project's preferredIdentifierStrategy, or "TEXT" when unset).
 */
function referenceModePkType(ot: ObjectType, model: OrmModel, fallbackPkType: string): string {
  // Heuristic: first binary fact type with a value type.
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
