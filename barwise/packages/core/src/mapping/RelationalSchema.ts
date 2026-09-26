/**
 * Relational schema data model.
 *
 * Represents the output of the ORM-to-relational mapping: tables, columns,
 * primary keys, and foreign keys.
 */

export interface Column {
  readonly name: string;
  readonly dataType: string;
  /**
   * True when nothing in the model declared this column's type and the
   * mapper used a fallback: a value type with no data type, a key typed by
   * the preferred-identifier strategy, or a foreign key copying such a key.
   * The export annotations read it to say "not declared" only when that
   * is true. Before it existed they compared `dataType` to the string
   * "TEXT", which flagged every declared text column and missed a
   * defaulted INTEGER or UUID key (dbt-key-type-fidelity.spec.md, D2).
   */
  readonly dataTypeDefaulted: boolean;
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
