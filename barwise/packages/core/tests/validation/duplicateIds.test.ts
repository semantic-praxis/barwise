/**
 * Defects the model can hold, so validation reports them
 * (`docs/specs/model-invariants.spec.md`, workstream 1): two constraints
 * sharing an id, and two subtype facts relating the same pair.
 *
 * Each is planted the ways it can actually arrive -- a 2.0 file, a lenient
 * load, code, a merge -- because the rule exists for the paths that are not
 * already refused somewhere else, and the refusing paths are pinned too.
 */
import { describe, expect, it } from "vitest";
import { diffModels, mergeAndValidate } from "../../src/diff/index.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

const serializer = new OrmYamlSerializer();

const findings = (model: OrmModel, ruleId: string) =>
  new ValidationEngine().validate(model).filter((d) => d.ruleId === ruleId);

/** Two unary fact types over one entity, each with a mandatory constraint. */
function twoFactTypes(firstId: string, secondId: string): OrmModel {
  const model = new OrmModel({ name: "M" });
  model.addObjectType({ id: "x", name: "A", kind: "entity", referenceMode: "a_id" });
  model.addFactType({
    id: "f1",
    name: "A runs",
    roles: [{ id: "r1", name: "runs", playerId: "x" }],
    readings: ["{0} runs"],
    constraints: [{ type: "mandatory", id: firstId, roleId: "r1" }],
  });
  model.addFactType({
    id: "f2",
    name: "A walks",
    roles: [{ id: "r2", name: "walks", playerId: "x" }],
    readings: ["{0} walks"],
    constraints: [{ type: "mandatory", id: secondId, roleId: "r2" }],
  });
  return model;
}

describe("structural/duplicate-constraint-id", () => {
  const RULE = "structural/duplicate-constraint-id";

  it("reports two constraints built in code with one id, once, naming both", () => {
    const found = findings(twoFactTypes("c", "c"), RULE);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ severity: "error", elementId: "c" });
    expect(found[0]!.message).toBe(
      'Constraint id "c" is used by more than one constraint: '
        + 'mandatory in fact type "A runs"; mandatory in fact type "A walks". '
        + "A constraint id names one constraint.",
    );
  });

  it("is silent when the ids differ", () => {
    expect(findings(twoFactTypes("c1", "c2"), RULE)).toEqual([]);
  });

  it("names a constraint stored on the model by the roles it names", () => {
    const model = twoFactTypes("c1", "c2");
    model.addConstraint({ type: "exclusion", id: "c1", roleIds: ["r1", "r2"] });
    const found = findings(model, RULE);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain(
      'mandatory in fact type "A runs"; exclusion over roles r1, r2',
    );
  });

  it("tells apart two constraints of one kind stored on the model", () => {
    const model = twoFactTypes("c1", "c2");
    model.addConstraint({ type: "exclusion", id: "x", roleIds: ["r1", "r2"] });
    model.addConstraint({ type: "exclusion", id: "x", roleIds: ["r2", "r1"] });
    expect(findings(model, RULE)[0]!.message).toContain(
      "exclusion over roles r1, r2; exclusion over roles r2, r1",
    );
  });

  const twoZero = (secondRole: string) =>
    `orm_version: "2.0"
model:
  name: M
  object_types:
    - { id: x, name: A, kind: entity, reference_mode: a_id }
  fact_types:
    - id: f1
      name: A runs
      roles: [{ id: r1, role_name: runs, player: x }]
      readings: ["{0} runs"]
      constraints:
        - { id: c, type: mandatory, role: r1 }
    - id: f2
      name: A walks
      roles: [{ id: r2, role_name: walks, player: x }]
      readings: ["{0} walks"]
      constraints:
        - { id: c, type: exclusion, roles: [r1, ${secondRole}] }
`;

  it("reports it from a 2.0 file, which the 2.0 reader does not refuse", () => {
    const found = findings(serializer.deserialize(twoZero("r2")), RULE);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain(
      'mandatory in fact type "A runs"; exclusion over roles r1, r2',
    );
  });

  it("still reports it when the duplicated constraint's own role dangles", () => {
    // The holders are named from what the file states (kind, home, the
    // role ids as written), never from what a role resolves to, so the
    // dangling role that suppresses the graph-taking rules cannot hide it.
    const model = serializer.deserialize(twoZero("nowhere"), { lenient: true });
    const all = new ValidationEngine().validate(model).map((d) => d.ruleId);
    expect(all).toContain("constraint/across-fact-types-unknown-role");
    expect(all.filter((id) => id === RULE)).toHaveLength(1);
  });

  it("is refused at load in a 3.0 file, before any rule runs", () => {
    const yaml = serializer.serialize(twoFactTypes("c", "c"));
    expect(() => serializer.deserialize(yaml)).toThrow(
      'Two constraints share the id "c"',
    );
  });

  const threeZero = (body: string) =>
    `orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: x, name: A, kind: entity, reference_mode: a_id }
${body}`;

  it("is refused under a lenient 3.0 load too, which barwise migrate relies on", () => {
    const yaml = serializer.serialize(twoFactTypes("c", "c"));
    expect(() => serializer.deserialize(yaml, { lenient: true })).toThrow(
      'Two constraints share the id "c"',
    );
  });

  it("is refused in a 3.0 file even when the two holders' fact types share an id", () => {
    // Read from what the file states: the id-keyed store keeps one of two
    // fact types with one id, and checking the built model would see one
    // constraint and load the file silently, losing the other.
    const yaml = threeZero(`  fact_types:
    - id: f
      name: A runs
      roles: [{ id: r1, role_name: runs, player: x }]
      readings: ["{0} runs"]
      constraints:
        - { id: c, type: mandatory, role: r1 }
    - id: f
      name: A swims
      roles: [{ id: r2, role_name: swims, player: x }]
      readings: ["{0} swims"]
      constraints:
        - { id: c, type: mandatory, role: r2 }
`);
    expect(() => serializer.deserialize(yaml)).toThrow('Two constraints share the id "c"');
  });

  it("is the error a strict 3.0 load reports when a role also dangles", () => {
    const yaml = threeZero(`  fact_types:
    - id: f1
      name: A runs
      roles: [{ id: r1, role_name: runs, player: nowhere }]
      readings: ["{0} runs"]
      constraints:
        - { id: c, type: mandatory, role: r1 }
    - id: f2
      name: A swims
      roles: [{ id: r2, role_name: swims, player: x }]
      readings: ["{0} swims"]
      constraints:
        - { id: c, type: mandatory, role: r2 }
`);
    expect(() => serializer.deserialize(yaml)).toThrow('Two constraints share the id "c"');
  });

  it("names a constraint over subtypes by its subtype facts", () => {
    const model = new OrmModel({ name: "People" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "m", name: "Male", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "f", name: "Female", kind: "entity", referenceMode: "id" });
    model.addSubtypeFact({ id: "sf-m", subtypeId: "m", supertypeId: "p" });
    model.addSubtypeFact({ id: "sf-f", subtypeId: "f", supertypeId: "p" });
    model.addConstraint({ type: "exclusion", id: "x", subtypeFactIds: ["sf-m", "sf-f"] });
    model.addConstraint({ type: "exclusive_or", id: "x", subtypeFactIds: ["sf-m", "sf-f"] });
    expect(findings(model, RULE)[0]!.message).toContain(
      "exclusion over subtype facts sf-m, sf-f; exclusive_or over subtype facts sf-m, sf-f",
    );
  });

  it("refuses a merge that would write it, which the 3.0 loader could not read back", () => {
    // An added fact type keeps its own constraints' ids (ModelMerge
    // addFactTypeToMerged), so a fact type that reads as removed-plus-added
    // brings a second constraint under the kept one's id. Before this rule
    // the merge reported success and wrote a file the loader then refused.
    const existing = twoFactTypes("c", "d");
    const incoming = new OrmModel({ name: "M" });
    incoming.addObjectType({ id: "x", name: "A", kind: "entity", referenceMode: "a_id" });
    incoming.addFactType({
      id: "g",
      name: "A swims",
      roles: [{ id: "r3", name: "swims", playerId: "x" }],
      readings: ["{0} swims"],
      constraints: [{ type: "mandatory", id: "c", roleId: "r3" }],
    });
    const diff = diffModels(existing, incoming);
    const additions = new Set(
      diff.deltas.flatMap((d, i) => (d.kind === "added" ? [i] : [])),
    );
    const result = mergeAndValidate(existing, incoming, diff.deltas, additions);
    expect(result.isValid).toBe(false);
    expect(result.diagnostics.map((d) => d.ruleId)).toContain(RULE);
  });
});

describe("a merge whose base already holds a duplicate constraint id", () => {
  it("is refused, since the merged file would not load as 3.0", () => {
    // The merge did not add the repeat, but it writes 3.0, and the 3.0
    // loader refuses a repeated constraint id: refusing here is what
    // stops a merge from writing a file nothing can read back.
    const existing = twoFactTypes("c", "c");
    const incoming = twoFactTypes("c", "c");
    incoming.addObjectType({ id: "y", name: "B", kind: "entity", referenceMode: "b_id" });
    const diff = diffModels(existing, incoming);
    const all = new Set(diff.deltas.map((_, i) => i));
    const result = mergeAndValidate(existing, incoming, diff.deltas, all);
    expect(result.isValid).toBe(false);
    expect(result.diagnostics.map((d) => d.ruleId)).toContain(
      "structural/duplicate-constraint-id",
    );
  });
});

describe("structural/duplicate-subtype-fact", () => {
  const RULE = "structural/duplicate-subtype-fact";

  const file = (version: "2.0" | "3.0") => {
    const flags = version === "2.0" ? ", is_exclusive: false, is_exhaustive: false" : "";
    return `orm_version: "${version}"
model:
  name: People
  object_types:
    - { id: p, name: Person, kind: entity, reference_mode: id }
    - { id: m, name: Manager, kind: entity, reference_mode: id }
  subtype_facts:
    - { id: sf1, subtype: m, supertype: p${flags} }
    - { id: sf2, subtype: m, supertype: p${flags} }
`;
  };

  for (const version of ["2.0", "3.0"] as const) {
    it(`reports the pair from a lenient ${version} load, once, naming both ids`, () => {
      const found = findings(serializer.deserialize(file(version), { lenient: true }), RULE);
      expect(found).toHaveLength(1);
      expect(found[0]).toMatchObject({ severity: "error", elementId: "sf2" });
      expect(found[0]!.message).toBe(
        'Subtype facts "sf1", "sf2" each make "Manager" a subtype of "Person"; '
          + "a subtype relationship is stated once.",
      );
    });

    it(`is refused before any rule runs by a strict ${version} load`, () => {
      expect(() => serializer.deserialize(file(version))).toThrow("already exists");
    });
  }

  it("reports three over one pair once, naming all three", () => {
    const yaml = file("3.0") + "    - { id: sf3, subtype: m, supertype: p }\n";
    const found = findings(serializer.deserialize(yaml, { lenient: true }), RULE);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('Subtype facts "sf1", "sf2", "sf3" each make');
  });

  it("is refused by addSubtypeFact in code", () => {
    const model = new OrmModel({ name: "People" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "m", name: "Manager", kind: "entity", referenceMode: "id" });
    model.addSubtypeFact({ id: "sf1", subtypeId: "m", supertypeId: "p" });
    expect(() => model.addSubtypeFact({ id: "sf2", subtypeId: "m", supertypeId: "p" }))
      .toThrow("already exists");
  });

  it("is silent for two subtypes of one supertype", () => {
    const yaml = file("3.0").replace("sf2, subtype: m", "sf2, subtype: p2")
      .replace(
        "    - { id: m, name: Manager",
        "    - { id: p2, name: Clerk, kind: entity, reference_mode: id }\n    - { id: m, name: Manager",
      );
    expect(findings(serializer.deserialize(yaml, { lenient: true }), RULE)).toEqual([]);
  });
});
