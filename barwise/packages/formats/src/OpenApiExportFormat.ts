/**
 * OpenAPI export format adapter.
 *
 * Wraps the existing renderOpenApi() function as an ExportFormat, adding:
 * - Validation with strict mode support
 * - Annotation support (x-barwise-annotations extension fields)
 * - ExportResult structure with annotations array
 * - Option forwarding (title, version, basePath)
 */

import {
  type ExportFormatAdapter,
  type ExportOptions,
  type ExportResult,
  type OrmModel,
  ValidationEngine,
} from "@barwise/core";
import { collectExportAnnotations, type ExportAnnotation } from "@barwise/core/annotation";
import { openApiToJson, RelationalMapper, renderOpenApi } from "@barwise/core/mapping";

/**
 * OpenAPI 3.0 export format.
 *
 * Produces an OpenAPI 3.0.0 specification from an ORM model via relational mapping.
 */
export class OpenApiExportFormat implements ExportFormatAdapter {
  readonly name = "openapi";
  readonly description = "OpenAPI 3.0 specification (JSON)";

  export(model: OrmModel, options?: ExportOptions): ExportResult {
    const annotate = options?.annotate ?? true;
    const strict = options?.strict ?? false;

    // Run validation.
    const engine = new ValidationEngine();
    const diagnostics = engine.validate(model);
    const errors = diagnostics.filter((d) => d.severity === "error");

    // If strict mode and there are errors, throw.
    if (strict && errors.length > 0) {
      const errorMessages = errors.map((e) => e.message).join("\n");
      throw new Error(
        `Cannot export model with validation errors in strict mode:\n${errorMessages}`,
      );
    }

    // Map to relational schema.
    const mapper = new RelationalMapper();
    const schema = mapper.map(model);

    // Collect annotations from the model and schema.
    const annotations = annotate
      ? collectExportAnnotations(model, schema)
      : [];

    // Extract OpenAPI-specific options.
    const title = (options?.title as string | undefined) ?? model.name;
    const version = (options?.version as string | undefined) ?? "1.0.0";
    const basePath = options?.basePath as string | undefined;

    // Render OpenAPI spec.
    const spec = renderOpenApi(schema, {
      title,
      version,
      basePath,
    });

    // Inject x-barwise-annotations extension fields into the spec.
    if (annotate && annotations.length > 0) {
      injectAnnotationExtensions(spec, annotations);
    }

    // Serialize to JSON.
    const text = openApiToJson(spec);

    // Include validation diagnostics as a comment if present and not strict.
    const validationWarnings = errors.length > 0
      ? `/* Validation warnings:\n${
        errors.map((e) => ` * ERROR: ${e.message}`).join("\n")
      }\n */\n\n`
      : "";

    return {
      text: validationWarnings + text,
      annotations: annotations.length > 0 ? annotations : undefined,
    };
  }
}

/**
 * Singleton instance of the OpenAPI export format.
 */
export const openApiExportFormat = new OpenApiExportFormat();

// ---------------------------------------------------------------------------
// Annotation injection
// ---------------------------------------------------------------------------

/** A single annotation entry in the x-barwise-annotations array. */
interface AnnotationExtension {
  readonly severity: "todo" | "note";
  readonly message: string;
}

/**
 * Inject `x-barwise-annotations` extension fields into OpenAPI schema objects.
 *
 * - Table-level annotations become extensions on the component schema object.
 * - Column-level annotations become extensions on the property object.
 *
 * This preserves valid OpenAPI while making annotations machine-readable
 * for downstream tooling.
 */
function injectAnnotationExtensions(
  spec: { components: { schemas: Record<string, unknown>; }; },
  annotations: readonly ExportAnnotation[],
): void {
  // Index annotations by table and table::column.
  const tableAnnotations = new Map<string, AnnotationExtension[]>();
  const columnAnnotations = new Map<string, AnnotationExtension[]>();

  for (const a of annotations) {
    const schemaName = toPascalCase(a.tableName);
    const entry: AnnotationExtension = { severity: a.severity, message: a.message };

    if (a.columnName) {
      const key = `${schemaName}::${a.columnName}`;
      const existing = columnAnnotations.get(key) ?? [];
      existing.push(entry);
      columnAnnotations.set(key, existing);
    } else {
      const existing = tableAnnotations.get(schemaName) ?? [];
      existing.push(entry);
      tableAnnotations.set(schemaName, existing);
    }
  }

  const schemas = spec.components.schemas as Record<string, Record<string, unknown>>;

  for (const [schemaName, schemaObj] of Object.entries(schemas)) {
    // Add table-level annotations.
    const tAnnotations = tableAnnotations.get(schemaName);
    if (tAnnotations) {
      schemaObj["x-barwise-annotations"] = tAnnotations;
    }

    // Add column-level annotations to properties.
    const properties = schemaObj.properties as Record<string, Record<string, unknown>> | undefined;
    if (!properties) continue;

    for (const [propName, propObj] of Object.entries(properties)) {
      const key = `${schemaName}::${propName}`;
      const cAnnotations = columnAnnotations.get(key);
      if (cAnnotations) {
        propObj["x-barwise-annotations"] = cAnnotations;
      }
    }
  }
}

/**
 * Convert a snake_case name to PascalCase.
 *
 * Must match the toPascalCase in openapi.ts so schema names align.
 */
function toPascalCase(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}
