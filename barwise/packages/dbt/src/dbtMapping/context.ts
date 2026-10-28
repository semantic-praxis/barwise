/**
 * Shared mutable state for the dbt-to-ORM mapping phases.
 *
 * The mapping runs in ordered phases that read and populate a set of
 * indices; this context threads that state explicitly instead of through
 * instance fields.
 */

import { OrmModel } from "@barwise/core";
import { ReportBuilder } from "../DbtImportReport.js";
import type { DbtProjectDocument } from "../DbtSchemaTypes.js";

/** Tracks a column identified as the PK of a model. */
export interface PkInfo {
  readonly columnName: string;
  readonly modelName: string;
}

/**
 * One reference (FK): a column's `relationships` test, or a model-level
 * `foreign_key` constraint over several columns, which is one reference
 * however many columns it has (composite-foreign-key-round-trip.spec.md).
 * Every phase asks which reference a column is in through this, never
 * through one column's test, so the two forms read alike.
 */
export interface RelationshipInfo {
  readonly columns: readonly string[];
  readonly targetModelName: string;
  readonly targetFields: readonly string[];
}

/** How a reference is named in the report: its column, or its columns. */
export function referenceName(rel: RelationshipInfo): string {
  return rel.columns.join(", ");
}

/**
 * Whether a model's reference is read as a fact type. A multi-column one
 * whose target has no entity keeps the reading it had before such a
 * reference was read at all: its columns are values, so nothing is lost.
 * A single-column one is a reference whatever its target, as before.
 */
export function readsAsReference(ctx: DbtMapperContext, rel: RelationshipInfo): boolean {
  return rel.columns.length === 1 || ctx.entityIdMap.has(rel.targetModelName);
}

/** A model keyed by a combination of columns, read as the fact type it states. */
export interface CompositeInfo {
  /** One column per role: the key's columns, then the extra column if any. */
  readonly roles: readonly (readonly string[])[];
  readonly key: readonly string[];
  readonly objectified: boolean;
}

/** Mutable state shared across the dbt-to-ORM mapping phases. */
export interface DbtMapperContext {
  readonly doc: DbtProjectDocument;
  readonly report: ReportBuilder;
  readonly model: OrmModel;
  /** model name -> PK info (if identifiable). */
  readonly pkMap: Map<string, PkInfo>;
  /** model name -> its references (relationships tests and multi-column foreign keys). */
  readonly relMap: Map<string, RelationshipInfo[]>;
  /** model name -> its composite-key reading (composite-key-tables.spec.md). */
  readonly compositeMap: Map<string, CompositeInfo>;
  /** model name -> entity type id in OrmModel. */
  readonly entityIdMap: Map<string, string>;
  /** "modelName::columnName" -> value type id. */
  readonly valueTypeIdMap: Map<string, string>;
  /**
   * "modelName::columnName" -> the entity-side role of the fact type the
   * column became. The relational mapper records the same role on the
   * column it emits, which is how `exportedColumns.ts` finds it.
   */
  readonly columnRoleIdMap: Map<string, string>;
  /** Source table data types: "sourceName.tableName.columnName" -> data_type string. */
  readonly sourceDataTypes: Map<string, string>;
  /** Column-level source data types: "columnName" -> data_type string (if unambiguous). */
  readonly sourceColumnTypes: Map<string, string | null>;
}

/** Build a fresh mapping context for the given document. */
export function createContext(doc: DbtProjectDocument): DbtMapperContext {
  return {
    doc,
    report: new ReportBuilder(),
    model: new OrmModel({ name: "dbt Import" }),
    pkMap: new Map<string, PkInfo>(),
    relMap: new Map<string, RelationshipInfo[]>(),
    compositeMap: new Map<string, CompositeInfo>(),
    entityIdMap: new Map<string, string>(),
    valueTypeIdMap: new Map<string, string>(),
    columnRoleIdMap: new Map<string, string>(),
    sourceDataTypes: new Map<string, string>(),
    sourceColumnTypes: new Map<string, string | null>(),
  };
}
