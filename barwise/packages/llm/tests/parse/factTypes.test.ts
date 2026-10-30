/**
 * The draft parser's fact types: a role the draft leaves unnamed is named
 * after its player, and in a ring fact type that name repeats, which the
 * model refuses (iri-identity, decision 5). The parser numbers the repeat,
 * so the fact type is imported rather than dropped with a warning.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parseFactTypes } from "../../src/parse/factTypes.js";

describe("parseFactTypes", () => {
  it("imports a ring fact type whose roles the draft left unnamed", () => {
    const model = new OrmModel({ name: "Staff" });
    model.addObjectType({ name: "Person", kind: "entity", referenceMode: "id" });
    const warnings: string[] = [];
    parseFactTypes(
      [{
        name: "Person manages Person",
        roles: [{ player: "Person", role_name: "" }, { player: "Person", role_name: "" }],
        readings: ["{0} manages {1}"],
        source_references: [],
      }],
      model,
      warnings,
    );
    expect(warnings).toEqual([]);
    expect(model.getFactTypeByName("Person manages Person")?.roles.map((r) => r.name)).toEqual([
      "person",
      "person_2",
    ]);
  });

  it("numbers role names by local name, as the model compares them", () => {
    const model = new OrmModel({ name: "Staff" });
    model.addObjectType({ name: "Person", kind: "entity", referenceMode: "id" });
    const warnings: string[] = [];
    parseFactTypes(
      [{
        name: "Person reports to Person",
        roles: [
          { player: "Person", role_name: "reports to" },
          { player: "Person", role_name: "reports_to" },
        ],
        readings: ["{0} reports to {1}"],
        source_references: [],
      }],
      model,
      warnings,
    );
    expect(warnings).toEqual([]);
    expect(model.getFactTypeByName("Person reports to Person")?.roles.map((r) => r.name))
      .toEqual(["reports to", "reports_to_2"]);
  });
});
