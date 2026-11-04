/**
 * export_model's `surrogateKeys` option (surrogate-key-export.spec.md):
 * honoured by a format whose descriptor declares it, refused for any
 * other with the message the CLI gives, rather than silently ignored by
 * the catch-all option bag.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { executeExportModel } from "../../src/tools/exportModel.js";

const ROOMS = readFileSync(
  resolve(import.meta.dirname, "../../../formats/tests/fixtures/externalIdentifier.orm.yaml"),
  "utf8",
);

describe("export_model with surrogateKeys", () => {
  it("gives a table keyed on several columns a generated key", () => {
    const text = executeExportModel(ROOMS, "ddl", { surrogateKeys: true, annotate: false })
      .content[0]!.text;
    expect(text).toContain("room_key VARCHAR(32) NOT NULL");
    expect(text).toContain("PRIMARY KEY (room_key)");
  });

  it("refuses it for a format that does not take it", () => {
    const parsed = JSON.parse(
      executeExportModel(ROOMS, "openapi", { surrogateKeys: true }).content[0]!.text,
    );
    expect(parsed.error).toBe("The openapi format does not take surrogate keys; ddl and dbt do.");
  });
});
