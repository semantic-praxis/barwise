/**
 * A constraint the DDL routing writes on a table is a source of that table
 * (routed-constraint-lineage.spec.md, barwise-20o): changing it changes the
 * table's text, so `lineage impact` has to name the table.
 */
import { describe, expect, it } from "vitest";
import { generateDdlLineage } from "../../src/lineage/generate.js";
import { analyzeImpact } from "../../src/lineage/impact.js";
import { routeConstraints } from "../../src/mapping/constraintRouting.js";
import { resolveDialectProfile } from "../../src/mapping/dialectCapabilities.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/** The DDL lineage of `model` as the DDL export builds it, for `dialect`. */
function lineage(model: OrmModel, dialect = "postgres") {
  const schema = new RelationalMapper().map(model);
  const routing = routeConstraints(model, schema, resolveDialectProfile(dialect), dialect);
  return generateDdlLineage(model, schema, routing.placements);
}

const constraintSourcesOf = (entries: ReturnType<typeof lineage>, table: string) =>
  entries.find((e) => e.artifact === table)!.sources
    .filter((s) => s.elementType === "Constraint")
    .map((s) => s.elementId);

/** Person reports to Person, with an irreflexive ring, which spills. */
function reporting(): OrmModel {
  const model = new OrmModel({ name: "Test" });
  model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "person_id" });
  model.addFactType({
    id: "ft",
    name: "Person reports to Person",
    roles: [
      { id: "r1", name: "reports to", playerId: "p" },
      { id: "r2", name: "manages", playerId: "p" },
    ],
    readings: ["{0} reports to {1}"],
    constraints: [
      { id: "uc", type: "internal_uniqueness", roleIds: ["r1"] },
      { id: "ring", type: "ring", roleId1: "r1", roleId2: "r2", ringType: "irreflexive" },
    ],
  });
  return model;
}

describe("DDL lineage lists the constraints the routing placed", () => {
  it("lists a spilled ring as a source of the table it comments", () => {
    expect(constraintSourcesOf(lineage(reporting()), "person")).toContain("ring");
  });

  it("lists a value constraint written as a CHECK clause", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "person_id" });
    model.addObjectType({ id: "g", name: "Grade", kind: "value", dataType: { name: "text" } });
    model.addFactType({
      id: "ft",
      name: "Person has Grade",
      roles: [
        { id: "r1", name: "has", playerId: "p" },
        { id: "r2", name: "is of", playerId: "g" },
      ],
      readings: ["{0} has {1}"],
      constraints: [
        { id: "uc", type: "internal_uniqueness", roleIds: ["r1"] },
        { id: "vc", type: "value_constraint", roleId: "r2", values: ["A", "B"] },
      ],
    });
    expect(constraintSourcesOf(lineage(model), "person")).toContain("vc");
  });

  it("lists a constraint over subtypes as a source of its supertype's table, named by it", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "p", name: "Party", kind: "entity", referenceMode: "party_id" });
    const facts = ["LegalEntity", "NaturalPerson"].map((name) => {
      model.addObjectType({ id: name, name, kind: "entity", referenceMode: `${name}_id` });
      return model.addSubtypeFact({ id: `sf-${name}`, subtypeId: name, supertypeId: "p" }).id;
    });
    model.addConstraint({ id: "x", type: "exclusion", subtypeFactIds: facts });
    const party = lineage(model).find((e) => e.artifact === "party")!;
    expect(party.sources.find((s) => s.elementId === "x")?.elementName).toBe(
      "Exclusion: subtypes of Party",
    );
  });

  it("words a placed constraint as stated, not enforced, in an impact report", () => {
    const exports = lineage(reporting()).map((e) => ({ ...e, format: "ddl" }));
    const impact = analyzeImpact(
      { version: 1, sourceModel: "m.orm.yaml", sourceModelHash: "h", exports } as never,
      "ring",
    );
    expect(impact.affectedArtifacts.map((a) => a.relationship)).toEqual([
      expect.stringMatching(/^states constraint /),
    ]);
  });
});
