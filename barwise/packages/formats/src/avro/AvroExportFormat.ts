/**
 * Avro export format adapter.
 *
 * Wraps the existing renderAvro() function as an ExportFormatAdapter, adding:
 * - Validation with strict mode support
 * - Annotation support (doc field annotations with [TODO/NOTE(barwise)] brackets)
 * - Multi-file ExportResult with individual .avsc files
 */

import {
  type ExportFormatAdapter,
  type ExportOptions,
  type ExportResult,
  type OrmModel,
  ValidationEngine,
} from "@barwise/core";
import { collectExportAnnotations, type ExportAnnotation } from "@barwise/core/annotation";
import {
  type AvroField,
  type AvroSchema,
  type AvroSchemaSet,
  avroSchemaToJson,
  RelationalMapper,
  renderAvro,
} from "@barwise/core/mapping";

/**
 * Apache Avro schema export format.
 *
 * Produces Avro record schemas (.avsc JSON) from an ORM model via
 * relational mapping. Each table becomes an Avro record type.
 */
export class AvroExportFormat implements ExportFormatAdapter {
  readonly name = "avro";
  readonly description = "Apache Avro schema definitions (.avsc)";

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

    // Extract Avro-specific options.
    const namespace = options?.namespace as string | undefined;

    // Render Avro schemas.
    let avroSchemaSet = renderAvro(schema, { namespace });

    // Inject annotations into doc fields.
    if (annotate && annotations.length > 0) {
      avroSchemaSet = injectDocAnnotations(avroSchemaSet, annotations);
    }

    // Build individual files.
    const files: Array<{ name: string; content: string; }> = [];
    const schemaTexts: string[] = [];

    for (const avroSchema of avroSchemaSet.schemas) {
      const json = avroSchemaToJson(avroSchema);
      const fileName = `${avroSchema.name}.avsc`;
      files.push({ name: fileName, content: json });
      schemaTexts.push(`# ${fileName}\n${json}`);
    }

    // Build combined text view.
    const sections: string[] = [];

    // Include validation warnings if present.
    if (errors.length > 0) {
      sections.push(
        `# Validation warnings:\n${errors.map((e) => `# ERROR: ${e.message}`).join("\n")}`,
      );
    }

    sections.push(...schemaTexts);

    const text = sections.join("\n\n---\n\n");

    return {
      text,
      files,
      annotations: annotations.length > 0 ? annotations : undefined,
    };
  }
}

// ---------------------------------------------------------------------------
// Annotation injection
// ---------------------------------------------------------------------------

/**
 * Format an annotation for embedding in an Avro doc field.
 *
 * Uses a bracket convention that can be parsed back out if needed:
 * `[TODO(barwise): message]` or `[NOTE(barwise): message]`
 */
function formatDocAnnotation(severity: "todo" | "note", message: string): string {
  const prefix = severity === "note" ? "NOTE(barwise)" : "TODO(barwise)";
  return `[${prefix}: ${message}]`;
}

/**
 * Inject annotations into Avro schema doc fields.
 *
 * - Record-level annotations are appended to the schema's `doc` field.
 * - Field-level annotations are appended to the field's `doc` field.
 *
 * Returns a new AvroSchemaSet (Avro types are readonly).
 */
function injectDocAnnotations(
  schemaSet: AvroSchemaSet,
  annotations: readonly ExportAnnotation[],
): AvroSchemaSet {
  // Index annotations by PascalCase record name and record::column.
  const recordAnnotations = new Map<string, ExportAnnotation[]>();
  const fieldAnnotations = new Map<string, ExportAnnotation[]>();

  for (const a of annotations) {
    const recordName = toPascalCase(a.tableName);

    if (a.columnName) {
      const key = `${recordName}::${a.columnName}`;
      const existing = fieldAnnotations.get(key) ?? [];
      existing.push(a);
      fieldAnnotations.set(key, existing);
    } else {
      const existing = recordAnnotations.get(recordName) ?? [];
      existing.push(a);
      recordAnnotations.set(recordName, existing);
    }
  }

  const schemas = schemaSet.schemas.map((schema): AvroSchema => {
    // Append record-level annotations to doc.
    const rAnnotations = recordAnnotations.get(schema.name);
    let doc = schema.doc;
    if (rAnnotations) {
      const annotationText = rAnnotations
        .map((a) => formatDocAnnotation(a.severity, a.message))
        .join(" ");
      doc = doc ? `${doc} ${annotationText}` : annotationText;
    }

    // Process fields for column-level annotations.
    const fields = schema.fields.map((field): AvroField => {
      const key = `${schema.name}::${field.name}`;
      const fAnnotations = fieldAnnotations.get(key);
      if (!fAnnotations) return field;

      const annotationText = fAnnotations
        .map((a) => formatDocAnnotation(a.severity, a.message))
        .join(" ");
      const fieldDoc = field.doc
        ? `${field.doc} ${annotationText}`
        : annotationText;

      return { ...field, doc: fieldDoc };
    });

    return { ...schema, doc, fields };
  });

  return { schemas };
}

/**
 * Convert a snake_case name to PascalCase.
 *
 * Must match the toPascalCase in avro.ts so record names align.
 */
function toPascalCase(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}
