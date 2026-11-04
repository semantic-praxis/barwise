/**
 * DDL export with generated keys over the tracked models
 * (surrogate-key-export.spec.md, barwise-td6): no foreign key spans
 * several columns, every table that was keyed on several columns has a
 * one-column key, and every natural key a generated key replaced is still
 * written as a UNIQUE.
 */
import { OrmYamlSerializer } from "@barwise/core";
import {
  RelationalMapper,
  routeUniqueOnly,
  SURROGATE_POPULATION_NOTE,
} from "@barwise/core/mapping";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";

const ROOT = resolve(import.meta.dirname, "../../..");
const tracked = execFileSync("git", ["ls-files", "--", "*.orm.yaml"], { cwd: ROOT })
  .toString().trim().split("\n");
const load = (file: string) => {
  try {
    return new OrmYamlSerializer().deserialize(readFileSync(resolve(ROOT, file), "utf8"));
  } catch {
    return undefined; // A fixture the serializer refuses has nothing to export.
  }
};

describe("a DDL export with generated keys", () => {
  let wide = 0;
  for (const file of tracked) {
    const model = load(file);
    if (!model) continue;
    const plain = new RelationalMapper().map(model);
    const keyed = plain.tables.filter((t) => t.primaryKey.columnNames.length > 1);
    if (keyed.length === 0) continue;
    wide += keyed.length;
    it(file, () => {
      const schema = new RelationalMapper().map(model, { surrogateKeys: true });
      for (const t of schema.tables) {
        expect([t.name, t.primaryKey.columnNames.length]).toEqual([t.name, 1]);
        for (const fk of t.foreignKeys) {
          expect([t.name, fk.columnNames.length]).toEqual([t.name, 1]);
        }
      }
      // Routing decides every UNIQUE the DDL writes; a column name can need
      // quoting, so the decision is read rather than the text.
      const uniques = routeUniqueOnly(model, schema).uniques
        .map((u) => `${u.tableName}:${[...u.columns].sort().join(",")}`);
      for (const t of schema.tables.filter((x) => x.naturalKey)) {
        expect(uniques).toContain(`${t.name}:${[...t.naturalKey!].sort().join(",")}`);
      }
    });
  }
  it("finds tables keyed on several columns in the corpus", () => expect(wide).toBeGreaterThan(20));

  it("writes no population rows, and says why", () => {
    const model = load("packages/core/tests/integration/fixtures/populationInstances.orm.yaml")!;
    const withKeys = new DdlExportFormat().export(model, { surrogateKeys: true }).text;
    const without = new DdlExportFormat().export(model).text;
    expect(without).toContain("INSERT INTO");
    expect(withKeys).not.toContain("INSERT INTO");
    expect(withKeys).toContain(`-- ${SURROGATE_POPULATION_NOTE.split("\n")[0]}`);
  });

  it("names the natural keys a dialect with no UNIQUE cannot enforce", () => {
    const model = load("packages/formats/tests/fixtures/externalIdentifier.orm.yaml")!;
    const text = new DdlExportFormat().export(model, {
      surrogateKeys: true,
      annotate: false,
      dialect: "bigquery",
    }).text;
    expect(text).toContain("-- bigquery has no UNIQUE, so these natural keys");
    expect(text).toContain("--   room (building_code, room_nr)");
  });
});
