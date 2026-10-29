/**
 * The constraints a format that renders only the relational schema
 * drops (schema-export-constraint-specs.spec.md): every one the router
 * would spill if the target had neither UNIQUE nor CHECK.
 */
import { describe, expect, it } from "vitest";
import {
  routeConstraints,
  routeUniqueOnly,
  unreportedConstraintSpecs,
} from "../../src/mapping/constraintRouting.js";
import { resolveDialectProfile } from "../../src/mapping/dialectCapabilities.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder, roleId } from "../helpers/ModelBuilder.js";

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
    roleId: roleId("Person has Score", 2),
    values: ["1", "2", "3"],
  });
  model.getFactTypeByName("Person starts on StartDay")!.addConstraint({
    type: "value_comparison",
    roleId1: roleId("Person starts on StartDay", 2),
    roleId2: roleId("Person ends on EndDay", 2),
    operator: "<=",
  });
  model.getFactTypeByName("Person mentors Person")!.addConstraint({
    type: "ring",
    roleId1: roleId("Person mentors Person", 1),
    roleId2: roleId("Person mentors Person", 2),
    ringType: "irreflexive",
  });
  model.addConstraint({
    type: "subset",
    subsetRoleIds: [roleId("Person has Grade", 1)],
    supersetRoleIds: [roleId("Person has Score", 1)],
  });
  return model;
}

describe("unreportedConstraintSpecs", () => {
  it("reports every constraint the schema does not carry, and no mandatory", () => {
    const model = sixKinds();
    const specs = unreportedConstraintSpecs(model, new RelationalMapper().map(model));
    expect(specs).toHaveLength(6);
    expect(specs.map((s) => s.verbalization).join("\n")).not.toMatch(/at least one/);
    // One spec per kind, each recognisable by its own pseudocode.
    const kinds = [
      /Person has Email/, // the secondary uniqueness on Email
      /one of \{1, 2, 3\}/, // the role value constraint on Score
      /one of \{A, B\}/, // Grade's own value constraint
      /<=/, // the value comparison
      /not Person mentors Person\(x, x\)/, // the ring
      /subset/, // the subset
    ];
    for (const kind of kinds) {
      expect(specs.filter((s) => kind.test(s.pseudocode))).toHaveLength(1);
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

  it("reports two constraints that verbalize alike, which DDL's comments keep once", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withValueType("Score", { dataType: { name: "integer" } })
      .withBinaryFactType("Person has best Score", {
        role1: { player: "Person", name: "has best" },
        role2: { player: "Score", name: "is best of" },
        uniqueness: "role1",
      })
      .withBinaryFactType("Person has worst Score", {
        role1: { player: "Person", name: "has worst" },
        role2: { player: "Score", name: "is worst of" },
        uniqueness: "role1",
      })
      .build();
    for (const name of ["best", "worst"]) {
      model.getFactTypeByName(`Person has ${name} Score`)!.addConstraint({
        type: "value_constraint",
        roleId: roleId(`Person has ${name} Score`, 2),
        values: ["1", "2"],
      });
    }
    const schema = new RelationalMapper().map(model);
    const specs = unreportedConstraintSpecs(model, schema);
    expect(specs.map((s) => s.pseudocode).sort()).toEqual([
      "value of Score.is best of is one of {1, 2}",
      "value of Score.is worst of is one of {1, 2}",
    ]);
  });

  it("reports a value type's own value constraint once per column it fills", () => {
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
    expect(unreportedConstraintSpecs(model, schema).map((s) => s.pseudocode).sort()).toEqual([
      "value of Hour.is end of is one of {8, 9}",
      "value of Hour.is start of is one of {8, 9}",
    ]);
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

  it("reports a mandatory the mapping does not enforce (barwise-plq)", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_nr" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role1",
      })
      .build();
    const specs = unreportedConstraintSpecs(model, new RelationalMapper().map(model));
    expect(specs.map((s) => s.verbalization)).toEqual(["Each Customer places at least one Order."]);
  });
});

describe("a constraint over subtypes", () => {
  it("is reported, since no schema export carries it (barwise-lwy)", () => {
    const model = new OrmModel({ name: "Test" });
    const party = model.addObjectType({
      id: "p",
      name: "Party",
      kind: "entity",
      referenceMode: "party_id",
    });
    const facts = ["LegalEntity", "NaturalPerson"].map((name) => {
      const sub = model.addObjectType({
        id: name,
        name,
        kind: "entity",
        referenceMode: `${name}_id`,
      });
      return model.addSubtypeFact({ id: `sf-${name}`, subtypeId: sub.id, supertypeId: party.id })
        .id;
    });
    model.addConstraint({ id: "c", type: "exclusion", subtypeFactIds: facts });
    const schema = new RelationalMapper().map(model);
    expect(unreportedConstraintSpecs(model, schema).map((s) => s.verbalization)).toEqual([
      "Each Party is at most one of: LegalEntity, NaturalPerson.",
    ]);
  });
});

describe("routeUniqueOnly (dbt-alternate-uniqueness.spec.md)", () => {
  it("names the UNIQUE the DDL export writes, and reports the rest", () => {
    const model = sixKinds();
    const schema = new RelationalMapper().map(model);
    const { uniques, constraintSpecs } = routeUniqueOnly(model, schema);
    // The secondary uniqueness on Email, by table and columns, not SQL.
    expect(uniques).toEqual([{ tableName: "person", columns: ["email"] }]);
    const full = routeConstraints(model, schema, resolveDialectProfile("postgres"), "postgres");
    expect(full.clauses.find((c) => c.sql === "UNIQUE (email)")?.columns).toEqual(["email"]);
    // Everything but that uniqueness is still reported.
    expect(constraintSpecs).toHaveLength(5);
    expect(constraintSpecs.map((s) => s.pseudocode).join("\n")).not.toMatch(/Person has Email/);
  });

  it("lists a UNIQUE two constraints write once: dbt refuses two tests of one name", () => {
    const model = sixKinds();
    const ft = model.getFactTypeByName("Person has Email")!;
    // A second uniqueness on the same role writes the same clause.
    ft.addConstraint({ type: "internal_uniqueness", roleIds: [roleId("Person has Email", 2)] });
    const schema = new RelationalMapper().map(model);
    expect(routeUniqueOnly(model, schema).uniques).toEqual([
      { tableName: "person", columns: ["email"] },
    ]);
  });
});
