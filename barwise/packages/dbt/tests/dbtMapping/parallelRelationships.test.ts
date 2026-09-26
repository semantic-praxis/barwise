/**
 * Two relationships from one model to the same target import as two
 * fact types, and no relationship shape makes the import throw
 * (docs/specs/dbt-import-parallel-relationships.spec.md, barwise-bvl).
 */
import { ValidationEngine } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { importDbtProject } from "../../src/DbtProjectImporter.js";

/** The enterprise trial's reproduction (trial/findings/barwise-bvl). */
const TWO_PORTS = `
version: 2
models:
  - name: stg_port
    columns:
      - name: port_code
        tests: [unique, not_null]
  - name: stg_leg
    columns:
      - name: leg_id
        tests: [unique, not_null]
      - name: origin_port_code
        tests:
          - relationships: { to: ref('stg_port'), field: port_code }
      - name: destination_port_code
        tests:
          - relationships: { to: ref('stg_port'), field: port_code }
`;

const names = (yaml: string) => importDbtProject([yaml]).model.factTypes.map((f) => f.name);

describe("R1: parallel relationships are named from their columns", () => {
  it("imports the reproduction as two fact types instead of throwing", () => {
    expect(names(TWO_PORTS)).toEqual(
      expect.arrayContaining(["Leg has origin Port", "Leg has destination Port"]),
    );
  });

  it("reads each qualified relationship source-first", () => {
    const { model } = importDbtProject([TWO_PORTS]);
    const ft = model.getFactTypeByName("Leg has origin Port")!;
    const rendered = ft.readings.map((r) =>
      r.template.replace(
        /\{(\d)\}/g,
        (_, i) => model.getObjectType(ft.roles[Number(i)]!.playerId)!.name,
      )
    );
    expect(rendered).toContain("Leg has origin Port");
  });

  it("imports a model that validates", () => {
    const { model } = importDbtProject([TWO_PORTS]);
    expect(new ValidationEngine().errors(model)).toEqual([]);
  });

  it("keeps the plain name for the column that adds nothing to the target key", () => {
    const yaml = `
models:
  - name: port
    columns:
      - name: port_id
        tests: [unique, not_null]
  - name: leg
    columns:
      - name: leg_id
        tests: [unique, not_null]
      - name: port_id
        tests: [{ relationships: { to: ref('port'), field: port_id } }]
      - name: return_port_id
        tests: [{ relationships: { to: ref('port'), field: port_id } }]
`;
    expect(names(yaml)).toEqual(expect.arrayContaining(["Leg has Port", "Leg has return Port"]));
  });

  it("imports a self-referencing model with two relationships to itself", () => {
    const yaml = `
models:
  - name: stg_product_bundles
    columns:
      - name: bundle_id
        tests: [unique, not_null]
      - name: parent_bundle_id
        tests: [{ relationships: { to: ref('stg_product_bundles'), field: bundle_id } }]
      - name: replaces_bundle_id
        tests: [{ relationships: { to: ref('stg_product_bundles'), field: bundle_id } }]
`;
    expect(names(yaml)).toEqual(expect.arrayContaining([
      "ProductBundles has parent ProductBundles",
      "ProductBundles has replaces ProductBundles",
    ]));
  });
});

describe("R3: a single relationship to a target keeps today's name", () => {
  it("names it <Source> has <Target>", () => {
    const yaml = `
models:
  - name: customers
    columns:
      - name: customer_id
        tests: [unique, not_null]
  - name: orders
    columns:
      - name: order_id
        tests: [unique, not_null]
      - name: placed_by_customer_id
        tests: [{ relationships: { to: ref('customers'), field: customer_id } }]
`;
    expect(names(yaml)).toContain("Orders has Customers");
  });
});

describe("R2: a name still taken after qualification is made free, never thrown", () => {
  it("falls back to <name> (<column>) and reports it", () => {
    // Two columns that qualify to the same words: a_b_port_id and a__b_port_id
    // both become "a b".
    const yaml = `
models:
  - name: port
    columns:
      - name: port_id
        tests: [unique, not_null]
  - name: leg
    columns:
      - name: leg_id
        tests: [unique, not_null]
      - name: a_b_port_id
        tests: [{ relationships: { to: ref('port'), field: port_id } }]
      - name: a__b_port_id
        tests: [{ relationships: { to: ref('port'), field: port_id } }]
`;
    const { model, report } = importDbtProject([yaml]);
    const legPort = model.factTypes.map((f) => f.name).filter((n) =>
      n.startsWith("Leg has") && n.includes("Port")
    );
    expect(legPort).toEqual(["Leg has a b Port", "Leg has a b Port (a__b_port_id)"]);
    expect(
      report.entries.some((e) => e.message.includes("a__b_port_id") && e.severity === "warning"),
    )
      .toBe(true);
  });
});
