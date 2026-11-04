/**
 * A column the Avro export renames keeps its notes. The renderer writes a
 * valid field name for a column Avro refuses (`(ambiguous)` becomes
 * `_ambiguous_`, barwise-9g3), and the annotations, which name columns,
 * were matched against field names, so every note on a renamed field was
 * dropped without a word.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AvroExportFormat } from "../src/avro/AvroExportFormat.js";

const MODEL = resolve(import.meta.dirname, "../../../examples/transcripts/pii-redaction.orm.yaml");

describe("an Avro field renamed from its column keeps the column's notes", () => {
  it("puts the column's annotations on the renamed field", () => {
    const model = new OrmYamlSerializer().deserialize(readFileSync(MODEL, "utf8"));
    const { files } = new AvroExportFormat().export(model);
    const finding = files!.map((f) =>
      JSON.parse(f.content) as {
        name: string;
        fields: { name: string; doc?: string; }[];
      }
    ).find((s) => s.name === "Finding")!;
    const field = finding.fields.find((f) => f.name === "_ambiguous_")!;
    expect(field.doc).toContain('The column "(ambiguous)".');
    expect(field.doc).toContain("Data type was not declared");
  });
});
