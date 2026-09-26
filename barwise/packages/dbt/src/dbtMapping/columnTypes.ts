/**
 * Column-level resolution shared by the key and non-key paths: which
 * data type a column declares, what its description is, and which value
 * type it may play.
 *
 * Key columns and ordinary columns used to be resolved by two different
 * paths -- ordinary columns here, key columns not at all -- so a declared
 * key type was dropped on import and guessed at every step downstream
 * (dbt-key-type-fidelity.spec.md). One resolver for both is what keeps
 * them from diverging again.
 */

import { type DataTypeDef, dataTypeOf, type ObjectType } from "@barwise/core";
import type { DbtColumn } from "../DbtSchemaTypes.js";
import type { DbtMapperContext } from "./context.js";
import { inferColumnDescription, resolveDataType } from "./naming.js";
import { resolveSourceColumnType } from "./sourceTypes.js";

/** A column's data type, and which definition supplied it. */
export interface ResolvedColumnType {
  readonly raw: string | undefined;
  readonly dataType: DataTypeDef | undefined;
  readonly source: "model" | "source" | "none";
}

/**
 * Resolve a column's data type: the model column's own `data_type`
 * first, then an unambiguous source-table column of the same name.
 */
export function resolveColumnType(
  ctx: DbtMapperContext,
  col: DbtColumn,
): ResolvedColumnType {
  if (col.dataType) {
    return { raw: col.dataType, dataType: resolveDataType(col.dataType), source: "model" };
  }
  const sourceType = resolveSourceColumnType(ctx, col.name);
  if (sourceType) {
    return { raw: sourceType, dataType: resolveDataType(sourceType), source: "source" };
  }
  return { raw: undefined, dataType: undefined, source: "none" };
}

/** Record in the import report where a column's data type came from. */
export function reportColumnType(
  ctx: DbtMapperContext,
  modelName: string,
  col: DbtColumn,
  resolved: ResolvedColumnType,
): void {
  if (resolved.source === "model") {
    ctx.report.info(
      "data_type",
      modelName,
      `Data type "${resolved.raw}" resolved for column "${col.name}".`,
      col.name,
    );
  } else if (resolved.source === "source") {
    ctx.report.info(
      "data_type",
      modelName,
      `Data type "${resolved.raw}" resolved for column "${col.name}" from source definitions.`,
      col.name,
    );
  } else {
    ctx.report.gap(
      "data_type",
      modelName,
      `No data_type for column "${col.name}" in model or source definitions.`,
      col.name,
    );
  }
}

/**
 * A column's description: the explicit one, or one inferred from its
 * name with a report warning saying so.
 */
export function resolveColumnDescription(
  ctx: DbtMapperContext,
  modelName: string,
  col: DbtColumn,
): string {
  if (col.description) return col.description;
  const inferred = inferColumnDescription(col.name, modelName);
  ctx.report.warning(
    "description",
    modelName,
    `No description for column "${col.name}". Inferred: "${inferred}"`,
    col.name,
  );
  return inferred;
}

/** Whether two data types are the same type: name, length and scale. */
export function sameDataType(
  a: DataTypeDef | undefined,
  b: DataTypeDef | undefined,
): boolean {
  if (!a || !b) return false;
  return a.name === b.name && a.length === b.length && a.scale === b.scale;
}

/**
 * The first name, starting from `preferred`, that no object type holds.
 *
 * `OrmModel.addObjectType` refuses a duplicate name by throwing, so every
 * fallback name is checked rather than assumed free.
 */
export function freeObjectTypeName(ctx: DbtMapperContext, preferred: string): string {
  if (!ctx.model.getObjectTypeByName(preferred)) return preferred;
  for (let i = 2;; i += 1) {
    const name = `${preferred}${i}`;
    if (!ctx.model.getObjectTypeByName(name)) return name;
  }
}

/** A short description of what holds a name, for a report message. */
export function describeHolder(holder: ObjectType): string {
  if (holder.kind === "entity") return `entity type "${holder.name}"`;
  return `value type "${holder.name}" (${formatDataType(dataTypeOf(holder))})`;
}

/** Render a data type the way a report reader would write it. */
export function formatDataType(dt: DataTypeDef | undefined): string {
  if (!dt) return "no data type";
  if (dt.length === undefined) return dt.name;
  return dt.scale === undefined
    ? `${dt.name}(${dt.length})`
    : `${dt.name}(${dt.length},${dt.scale})`;
}
