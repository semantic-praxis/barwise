/**
 * The constraints a format that renders only the relational schema
 * drops (schema-export-constraint-specs.spec.md): every one the router
 * would spill if the target had neither UNIQUE nor CHECK.
 */
import { describe, expect, it } from "vitest";
import {
  routeConstraints,
  unreportedConstraintSpecs,
} from "../../src/mapping/constraintRouting.js";
import { resolveDialectProfile } from "../../src/mapping/dialectCapabilities.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/**
 * One constraint of each kind the router routes or spills, with distinct
 * players and values so no two verbalizations coincide, and a mandatory
 * the mapping realizes as NOT NULL.
 */
function sixKinds(): OrmModel {
  const model = new ModelBuilder("Test")
    .withEntityType("Person", { referenceMode: "person_id" })
    .withValueType("Email", { dataType: { name: "text" } })
    .withValueType("Score", { dataType: { name: "integer" } })
    .withValueType("Grade", {
      dataType: { name: "text" },
      valueConstraint: { values: ["A", "B"] },
    })
    .withValueType("StartDay", { dataType: { name: "integer" } })
    .withValueType("EndDay", { dataType: { name: "integer" } })
    .withBinaryFactType("Person has Email", {
      role1: { player: "Person", name: "has" },
      role2: { player: "Email", name: "is of" },
      uniqueness: "both",
      mandatory: "role1",
    })
    .withBinaryFactType("Person has Score", {
      role1: { player: "Person", name: "scores" },
      role2: { player: "Score", name: "is score of" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Person has Grade", {
      role1: { player: "Person", name: "is graded" },
      role2: { player: "Grade", name: "is grade of" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Person starts on StartDay", {
      role1: { player: "Person", name: "starts" },
      role2: { player: "StartDay", name: "is start of" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Person ends on EndDay", {
      role1: { player: "Person", name: "ends" },
      role2: { player: "EndDay", name: "is end of" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Person mentors Person", {
      role1: { player: "Person", name: "mentors" },
      role2: { player: "Person", name: "is mentored by" },
      uniqueness: "role2",
    })
    .build();
  model.getFactTypeByName("Person has Score")!.addConstraint({
    type: "value_constraint",
    roleId: "Person has Score::role2",
    values: ["1", "2", "3"],
  });
  model.getFactTypeByName("Person starts on StartDay")!.addConstraint({
    type: "value_comparison",
    roleId1: "Person starts on StartDay::role2",
    roleId2: "Person ends on EndDay::role2",
    operator: "<=",
  });
  model.getFactTypeByName("Person mentors Person")!.addConstraint({
    type: "ring",
    roleId1: "Person mentors Person::role1",
    roleId2: "Person mentors Person::role2",
    ringType: "irreflexive",
  });
  model.addConstraint({
    type: "subset",
    subsetRoleIds: ["Person has Grade::role1"],
    supersetRoleIds: ["Person has Score::role1"],
  });
  return model;
}

describe("unreportedConstraintSpecs", () => {
  it("reports every constraint the schema does not carry, and no mandatory", () => {
    const model = sixKinds();
    const specs = unreportedConstraintSpecs(model, new RelationalMapper().map(model));
    const pseudocode = specs.map((s) => s.pseudocode).join("\n");
    expect(specs).toHaveLength(6);
    expect(specs.map((s) => s.verbalization).join("\n")).not.toMatch(/at least one/);
    for (const fragment of ["unique", "<=", "not Person mentors Person(x, x)", "subset"]) {
      expect(pseudocode).toContain(fragment);
    }
  });

  it("is what a full dialect would add as clauses or spill", () => {
    const model = sixKinds();
    const schema = new RelationalMapper().map(model);
    const full = routeConstraints(model, schema, resolveDialectProfile("postgres"), "postgres");
    // Secondary uniqueness, the two value constraints and the comparison
    // become clauses in postgres; the ring and the subset spill there too.
    expect(full.clauses).toHaveLength(4);
    expect(full.spilled).toHaveLength(2);
    expect(unreportedConstraintSpecs(model, schema)).toHaveLength(6);
  });

  it("reports a value type's own value constraint once, though it fills two columns", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Shift", { referenceMode: "shift_id" })
      .withValueType("Hour", {
        dataType: { name: "integer" },
        valueConstraint: { values: ["8", "9"] },
      })
      .withBinaryFactType("Shift starts at Hour", {
        role1: { player: "Shift", name: "starts at" },
        role2: { player: "Hour", name: "is start of" },
        uniqueness: "role1",
      })
      .withBinaryFactType("Shift ends at Hour", {
        role1: { player: "Shift", name: "ends at" },
        role2: { player: "Hour", name: "is end of" },
        uniqueness: "role1",
      })
      .build();
    const schema = new RelationalMapper().map(model);
    const full = routeConstraints(model, schema, resolveDialectProfile("postgres"), "postgres");
    expect(full.clauses).toHaveLength(2);
    expect(unreportedConstraintSpecs(model, schema)).toHaveLength(1);
  });

  it("reports nothing for a model whose constraints the schema carries", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withValueType("Name", { dataType: { name: "text" } })
      .withBinaryFactType("Person has Name", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "role1",
        mandatory: "role1",
      })
      .build();
    expect(unreportedConstraintSpecs(model, new RelationalMapper().map(model))).toEqual([]);
  });
});
