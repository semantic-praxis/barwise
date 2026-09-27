/**
 * Every standard exporter says which model elements its artifacts came
 * from (export-lineage-sources.spec.md R1, barwise-ofb). None did: the
 * generators in `@barwise/core/lineage` had no caller, so the CLI wrote
 * `sources: []` for every artifact. The CLI's export-then-impact test is
 * the surface check; this one names the exporter that regressed.
 */
import { describe, expect, it } from "vitest";
import { AvroExportFormat } from "../src/avro/AvroExportFormat.js";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { NormaExportFormat } from "../src/norma/NormaExportFormat.js";
import { OpenApiExportFormat } from "../src/openapi/OpenApiExportFormat.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

const model = new ModelBuilder("Test")
  .withEntityType("Customer", { referenceMode: "customer_id" })
  .withEntityType("Order", { referenceMode: "order_number" })
  .withBinaryFactType("Customer places Order", {
    role1: { player: "Customer", name: "places" },
    role2: { player: "Order", name: "is placed by" },
    uniqueness: "role2",
    mandatory: "role2",
  })
  .build();

const customerId = model.objectTypes.find((o) => o.name === "Customer")!.id;

describe("R1: each exporter records its sources", () => {
  it.each([
    ["ddl", new DdlExportFormat()],
    ["openapi", new OpenApiExportFormat()],
    ["avro", new AvroExportFormat()],
    ["norma", new NormaExportFormat()],
  ])("%s names the Customer entity among its sources", (_name, format) => {
    const { lineage } = format.export(model);
    expect(lineage?.length).toBeGreaterThan(0);
    const ids = lineage!.flatMap((e) => e.sources.map((s) => s.elementId));
    expect(ids).toContain(customerId);
  });
});
