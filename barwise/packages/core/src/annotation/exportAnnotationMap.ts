/**
 * Convenience entry points for surfaces that annotate their output from
 * the model alone (CLI, MCP, VS Code): run the relational mapping and
 * the export-annotation collection in one call, and reshape the result
 * for consumers keyed by model element id (the diagram graph).
 *
 * Annotation collection is best-effort: a model that cannot be
 * relationally mapped yields no annotations rather than failing the
 * caller's primary output.
 */
import { RelationalMapper } from "../mapping/RelationalMapper.js";
import type { OrmModel } from "../model/OrmModel.js";
import { collectExportAnnotations, type ExportAnnotation } from "./ExportAnnotationCollector.js";

/**
 * Collect export annotations for a model, deriving the relational
 * schema internally. Returns an empty list when the model cannot be
 * mapped.
 */
export function collectModelAnnotations(model: OrmModel): ExportAnnotation[] {
  try {
    const schema = new RelationalMapper().map(model);
    return collectExportAnnotations(model, schema);
  } catch {
    return [];
  }
}

/**
 * Curate export annotations down to the ones worth surfacing as
 * modeling questions or attention markers: "todo" severity only,
 * without the column-level description nags (an editorial reminder per
 * column would drown the genuine questions), deduplicated -- the
 * collector can emit the same gap once per column occurrence.
 */
export function collectOpenQuestionAnnotations(model: OrmModel): ExportAnnotation[] {
  const seen = new Set<string>();
  const curated: ExportAnnotation[] = [];
  for (const a of collectModelAnnotations(model)) {
    if (a.severity !== "todo") continue;
    if (a.category === "description" && a.columnName) continue;
    const key = `${a.tableName}|${a.columnName ?? ""}|${a.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    curated.push(a);
  }
  return curated;
}

/**
 * Collect the needs-attention annotations for a model, keyed by the
 * model element id each table maps back to -- the shape the diagram
 * graph consumes (`ModelToGraphOptions.annotations`).
 *
 * Carries the curated open-question set (see
 * `collectOpenQuestionAnnotations`): the diagram marker means "this
 * element needs attention", and informational notes or per-column
 * editorial nags would mark healthy elements.
 */
export function collectAnnotationMap(
  model: OrmModel,
): ReadonlyMap<string, readonly string[]> {
  const byElement = new Map<string, string[]>();

  let schema;
  try {
    schema = new RelationalMapper().map(model);
  } catch {
    return byElement;
  }

  const tableSource = new Map(schema.tables.map((t) => [t.name, t.sourceElementId]));
  for (const a of collectOpenQuestionAnnotations(model)) {
    const elementId = tableSource.get(a.tableName);
    if (!elementId) continue;
    const list = byElement.get(elementId) ?? [];
    list.push(`TODO(barwise): ${a.message}`);
    byElement.set(elementId, list);
  }
  return byElement;
}
