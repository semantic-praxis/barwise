/**
 * Format-agnostic annotation collector for ORM model exports.
 *
 * Analyzes an ORM model and its relational schema to produce
 * `ExportAnnotation[]` describing structural gaps and informational
 * notes. This collection is reused by all export annotators (dbt,
 * DDL, OpenAPI, Avro, diagram, verbalization) so they share identical
 * gap detection logic.
 *
 * Extracted from `DbtExportAnnotator.collectAnnotations()`.
 */

import type { RelationalSchema } from "../mapping/RelationalSchema.js";
import { isValueType, type ValueType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import { truncate } from "./helpers.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A single annotation describing a structural gap or informational
 * note about a table or column in the relational schema.
 */
export interface ExportAnnotation {
  /** Which table this annotation is for. */
  readonly tableName: string;
  /** Which column, if column-level (undefined = table-level). */
  readonly columnName?: string;
  /** Severity: "todo" produces `# TODO(barwise):`, "note" produces `# NOTE(barwise):`. */
  readonly severity: "todo" | "note";
  /** Annotation category. */
  readonly category: string;
  /** Human-readable message. */
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Collect annotations by analyzing an ORM model and its relational
 * schema for structural gaps.
 *
 * Returns an array of annotations that downstream format-specific
 * annotators can inject into their output using format-appropriate
 * mechanisms (SQL comments, YAML comments, extension fields, etc.).
 */
export function collectExportAnnotations(
  model: OrmModel,
  schema: RelationalSchema,
): ExportAnnotation[] {
  const annotations: ExportAnnotation[] = [];

  // Build lookup maps from ORM model.
  const entityById = new Map(
    model.objectTypes.filter((ot) => ot.kind === "entity").map((e) => [e.id, e]),
  );
  // `isValueType` rather than a `kind` comparison so the map is typed
  // `Map<string, ValueType>`: everything downstream reads `dataType` and
  // `valueConstraint` off it, and those live on the variant.
  const valueById = new Map(
    model.objectTypes.filter(isValueType).map((v) => [v.id, v]),
  );

  for (const table of schema.tables) {
    const entity = entityById.get(table.sourceElementId);

    // --- Table-level annotations ---

    // Missing model description.
    if (entity) {
      if (entity.definition) {
        annotations.push({
          tableName: table.name,
          severity: "note",
          category: "description",
          message: `Definition available from ORM model: "${truncate(entity.definition, 80)}"`,
        });
      } else {
        annotations.push({
          tableName: table.name,
          severity: "todo",
          category: "description",
          message:
            "No model description. Add a definition to the ORM entity type or edit the dbt YAML.",
        });
      }
    }

    // Composite PK note.
    if (table.primaryKey.columnNames.length > 1) {
      annotations.push({
        tableName: table.name,
        severity: "note",
        category: "constraint",
        message: `Composite primary key (${
          table.primaryKey.columnNames.join(", ")
        }). Individual unique tests are not generated.`,
      });
    }

    // --- Column-level annotations ---

    for (const col of table.columns) {
      // Find the value type that sourced this column (via role traceability).
      const sourceValueType = col.sourceRoleId
        ? findValueTypeForRole(col.sourceRoleId, model, valueById)
        : undefined;

      // Missing column description.
      annotations.push({
        tableName: table.name,
        columnName: col.name,
        severity: "todo",
        category: "description",
        message: "No column description. Add one to the dbt YAML.",
      });

      // Default TEXT data type.
      if (col.dataType === "TEXT") {
        annotations.push({
          tableName: table.name,
          columnName: col.name,
          severity: "todo",
          category: "data_type",
          message:
            "Data type defaulted to TEXT. Add a data type to the ORM value type or edit the dbt YAML.",
        });
      }

      // Value constraint available for accepted_values test.
      if (sourceValueType?.valueConstraint) {
        const vals = sourceValueType.valueConstraint.values;
        annotations.push({
          tableName: table.name,
          columnName: col.name,
          severity: "note",
          category: "accepted_values",
          message: `Value constraint available: [${
            vals.map((v) => `'${v}'`).join(", ")
          }]. Consider adding an accepted_values test.`,
        });
      }
    }
  }

  return annotations;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Given a role ID from a relational column's sourceRoleId, find the
 * value type in the same fact type. The sourceRoleId points to the
 * entity's role; the value type plays the *other* role.
 */
function findValueTypeForRole(
  roleId: string,
  model: OrmModel,
  valueById: Map<string, ValueType>,
): ValueType | undefined {
  for (const ft of model.factTypes) {
    const matchIdx = ft.roles.findIndex((r) => r.id === roleId);
    if (matchIdx === -1) continue;

    // The matched role is the entity's role. Look for a value type
    // among the other roles in this fact type.
    for (let i = 0; i < ft.roles.length; i++) {
      if (i === matchIdx) continue;
      const vt = valueById.get(ft.roles[i]!.playerId);
      if (vt) return vt;
    }
  }
  return undefined;
}
