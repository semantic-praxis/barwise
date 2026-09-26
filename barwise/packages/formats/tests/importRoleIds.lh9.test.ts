/**
 * barwise-lh9: an importer must not derive a role id from a property or
 * column name, because two schemas (or tables) sharing that name then
 * write the same role id twice and the imported model fails
 * structural/duplicate-role-id. Fixed by importer-role-ids.spec.md, which
 * mints every role id; this is the enterprise trial's reproduction
 * (trial/findings/barwise-lh9/api.json), moved here when the fix landed,
 * as trial/README.md requires.
 *
 * The oracle is validation of the imported model, which is what the
 * trial's validate-imported and acceptance steps checked.
 */
import { ValidationEngine } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";
import { OpenApiImportFormat } from "../src/openapi/OpenApiImportFormat.js";

/** Two schemas, one property name: the trial's reproduction, verbatim. */
const TWO_SCHEMAS_ONE_PROPERTY = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Two schemas, one property name", version: "1.0.0" },
  paths: {},
  components: {
    schemas: {
      Provider: {
        type: "object",
        properties: {
          name: { type: "string" },
          related: { $ref: "#/components/schemas/Patient" },
        },
      },
      Payer: {
        type: "object",
        properties: {
          name: { type: "string" },
          related: { $ref: "#/components/schemas/Patient" },
        },
      },
      Patient: { type: "object", properties: { name: { type: "string" } } },
    },
  },
});

/** The DDL form of the same collision: two tables, one column name. */
const TWO_TABLES_ONE_COLUMN = `
CREATE TABLE subject (subject_id INTEGER PRIMARY KEY, site_code VARCHAR(10) NOT NULL);
CREATE TABLE visit (visit_id INTEGER PRIMARY KEY, site_code VARCHAR(10) NOT NULL);
`;

function roleIds(model: { factTypes: readonly { roles: readonly { id: string; }[]; }[]; }) {
  return model.factTypes.flatMap((ft) => ft.roles.map((r) => r.id));
}

describe("barwise-lh9: imported role ids are unique", () => {
  it("OpenAPI: two schemas with the same property name import as a valid model", () => {
    const { model } = new OpenApiImportFormat().parse(TWO_SCHEMAS_ONE_PROPERTY);
    // The shape the finding described: both `related` properties became
    // fact types, so a collision had somewhere to happen.
    expect(model.factTypes.filter((ft) => ft.roles.some((r) => r.name === "related")))
      .toHaveLength(2);
    const ids = roleIds(model);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });

  it("DDL: two tables with the same column name import as a valid model", () => {
    const { model } = new DdlImportFormat().parse(TWO_TABLES_ONE_COLUMN);
    const ids = roleIds(model);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });
});
