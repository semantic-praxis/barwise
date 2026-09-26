/**
 * Every relational export format passes the project's identifier strategy
 * to the mapper (identifier-strategy-in-exports.spec.md, R1). Before, each
 * called `map(model)` with no options, so a project's
 * `preferred_identifier_strategy` never reached an export.
 */
import type { ExportFormatAdapter } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { AvroExportFormat } from "../src/avro/AvroExportFormat.js";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { OpenApiExportFormat } from "../src/openapi/OpenApiExportFormat.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

const model = new ModelBuilder("Strategy")
  .withEntityType("Customer", { referenceMode: "customer_id" })
  .build();

const text = (format: ExportFormatAdapter, strategy?: "integer" | "uuid") =>
  format.export(model, {
    includeExamples: false,
    ...(strategy ? { preferredIdentifierStrategy: strategy } : {}),
  }).text;

const TODO = "exported as INTEGER by the project's identifier strategy";

describe("R1: the identifier strategy reaches each format's mapping", () => {
  it("DDL types the key by it", () => {
    expect(text(new DdlExportFormat(), "integer")).toContain("customer_id INTEGER NOT NULL");
    expect(text(new DdlExportFormat(), "uuid")).toContain("customer_id UUID NOT NULL");
    expect(text(new DdlExportFormat())).toContain("customer_id TEXT NOT NULL");
  });

  it("OpenAPI types the key by it", () => {
    const spec = JSON.parse(text(new OpenApiExportFormat(), "integer"));
    const schemas = spec.components.schemas as Record<
      string,
      { properties: Record<string, unknown>; }
    >;
    const key = Object.values(schemas).find((s) => s.properties?.["customer_id"])!
      .properties["customer_id"] as { type: string; };
    expect(key.type).toBe("integer");
  });

  it("Avro types the key by it", () => {
    // Avro writes one .avsc per record; the text is a headed concatenation.
    const files = new AvroExportFormat().export(model, {
      includeExamples: false,
      preferredIdentifierStrategy: "integer",
    }).files!;
    const schema = JSON.parse(files[0]!.content);
    const field = (schema.fields as { name: string; type: unknown; }[])
      .find((f) => f.name === "customer_id")!;
    expect(field.type).toBe("long");
  });

  it("each keeps the not-declared TODO and says the strategy chose the type (R3)", () => {
    for (
      const format of [new DdlExportFormat(), new OpenApiExportFormat(), new AvroExportFormat()]
    ) {
      expect(text(format, "integer"), format.name).toContain(TODO);
    }
  });
});
