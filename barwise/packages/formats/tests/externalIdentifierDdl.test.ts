/**
 * An external preferred identifier is the table's key, so the DDL router
 * does not route its uniqueness again as a UNIQUE clause
 * (external-preferred-identifier.spec.md, WS1). Its external branch had no
 * whole-key check, unlike the internal one.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";

const ddlFormat = new DdlExportFormat();

const fixture = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/externalIdentifier.orm.yaml",
);

describe("DDL export of an externally identified entity", () => {
  it("keys room on building and room number, with no separate UNIQUE", () => {
    const model = new OrmYamlSerializer().deserialize(readFileSync(fixture, "utf8"));
    const room = /CREATE TABLE room \(([^;]*)\);/.exec(
      ddlFormat.export(model, { annotate: false }).text,
    )![1]!;
    expect(room).toContain("PRIMARY KEY (building_code, room_nr)");
    expect(room).not.toContain("UNIQUE");
    expect(room).not.toContain("room_id");
  });
});
