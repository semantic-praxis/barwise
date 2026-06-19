/**
 * Relational schema data model.
 *
 * Represents the output of the ORM-to-relational mapping: tables, columns,
 * primary keys, and foreign keys.
 */

export interface Column {
  readonly name: string;
  readonly dataType: string;
  readonly nullable: boolean;
  /** The role id this column was derived from (traceability). */
  readonly sourceRoleId?: string;
  /** Default value (from the value type's default), rendered as SQL DEFAULT. */
  readonly defaultValue?: string;
}

export interface PrimaryKey {
  readonly columnNames: readonly string[];
}

export interface ForeignKey {
  readonly columnNames: readonly string[];
  readonly referencedTable: string;
  readonly referencedColumns: readonly string[];
  /** The constraint id this FK was derived from (traceability). */
  readonly sourceConstraintId?: string;
}

export interface Table {
  readonly name: string;
  readonly columns: readonly Column[];
  readonly primaryKey: PrimaryKey;
  readonly foreignKeys: readonly ForeignKey[];
  /** The model element id this table was derived from. */
  readonly sourceElementId: string;
}

export interface RelationalSchema {
  readonly tables: readonly Table[];
  readonly sourceModelId: string;
}
