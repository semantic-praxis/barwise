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

/** Tracks a relationship (FK) column. */
export interface RelationshipInfo {
  readonly columnName: string;
  readonly targetModelName: string;
  readonly targetField: string;
}

/** Mutable state shared across the dbt-to-ORM mapping phases. */
export interface DbtMapperContext {
  readonly doc: DbtProjectDocument;
  readonly report: ReportBuilder;
  readonly model: OrmModel;
  /** model name -> PK info (if identifiable). */
  readonly pkMap: Map<string, PkInfo>;
  /** model name -> relationship columns. */
  readonly relMap: Map<string, RelationshipInfo[]>;
  /** model name -> entity type id in OrmModel. */
  readonly entityIdMap: Map<string, string>;
  /** "modelName::columnName" -> value type id. */
  readonly valueTypeIdMap: Map<string, string>;
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
    entityIdMap: new Map<string, string>(),
    valueTypeIdMap: new Map<string, string>(),
    sourceDataTypes: new Map<string, string>(),
    sourceColumnTypes: new Map<string, string | null>(),
  };
}
