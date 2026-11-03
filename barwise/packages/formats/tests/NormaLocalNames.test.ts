/**
 * A NORMA import's ids are local names (iri-identity 6c): each element
 * takes the id its name or sentence gives, as a 4.0 file's do, whatever id
 * NORMA wrote for it. The mapper's own choices are tested under NORMA ids
 * (`helpers/underNormaIds.ts`); this file tests the names it returns.
 */
import { OrmYamlSerializer, ValidationEngine } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mapNormaToOrm } from "../src/norma/NormaToOrmMapper.js";
import { parseNormaXml } from "../src/norma/NormaXmlParser.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = [
  "orderManagement.orm",
  "personCountryDemo.orm",
  "universityEnrollment.orm",
  "employeeProject.orm",
];
const load = (fixture: string) =>
  mapNormaToOrm(parseNormaXml(readFileSync(resolve(here, "fixtures", fixture), "utf-8")));

describe("a NORMA import's ids", () => {
  it.each(FIXTURES)(
    "%s: are the ones the format's rules give, with nothing to migrate",
    (fixture) => {
      const reported = new ValidationEngine().validate(load(fixture))
        .filter((d) =>
          d.ruleId === "structural/id-not-from-name" || d.ruleId === "structural/replayed-ids"
          || d.ruleId === "structural/stale-minted-name"
        )
        .map((d) => `${d.ruleId}: ${d.message}`);
      expect(reported).toEqual([]);
    },
  );

  it.each(FIXTURES)("%s: hold no NORMA id", (fixture) => {
    const model = load(fixture);
    const ids = [
      ...model.objectTypes.map((ot) => ot.id),
      ...model.factTypes.flatMap((ft) => [ft.id, ...ft.roles.map((r) => r.id)]),
      ...model.everyConstraint().flatMap(([c]) => c.id ?? []),
      ...model.subtypeFacts.flatMap((sf) => sf.id ?? []),
    ];
    expect(ids.length).toBeGreaterThan(0);
    // NORMA writes "_" and a GUID, or "_" and a short token in hand-made files.
    expect(ids.filter((id) => id.startsWith("_"))).toEqual([]);
  });

  it.each(FIXTURES)("%s: are the same on every import", (fixture) => {
    const yaml = () => new OrmYamlSerializer().serialize(load(fixture));
    expect(yaml()).toBe(yaml());
  });

  it("name an object type and a role from their names", () => {
    const model = load("employeeProject.orm");
    const employee = model.getObjectTypeByName("Employee")!;
    expect(employee.id).toBe("Employee");
    const ft = model.getFactTypeByName("Employee has RoleName")!;
    expect(ft.roles.map((r) => r.id)).toContain("Employee_has_RoleName.is_of");
  });

  it("name an external constraint from its sentence, though NORMA lists it under its first fact type", () => {
    // NORMA lists the external uniqueness under the FirstName fact type,
    // before the LastName one it also spans exists; named there, its
    // sentence could not be built and it would be left unnamed.
    const model = load("employeeProject.orm");
    const external = model.constraints.filter((c) => c.type === "external_uniqueness");
    expect(external.map((c) => c.id)).toEqual([
      "The_combination_of_FirstName_and_LastName_is_unique_across_fact_types",
    ]);
    expect(model.preferredIdentifierOf("Employee")).toBe(external[0]!.id);
  });
});
