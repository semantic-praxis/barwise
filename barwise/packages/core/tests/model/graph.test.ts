/**
 * `graphOf` and the totality of a built `ModelGraph`.
 *
 * The failure cases come first on purpose. A totality test that has
 * never been seen reject anything proves only that nothing threw, which
 * is the reading barwise-906 is open about -- so each accessor's
 * guarantee is established against a model that CANNOT build before it
 * is asserted against models that can.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roleIdsOf } from "../../src/model/Constraint.js";
import { graphOf } from "../../src/model/graph.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/** Customer has Name, with a uniqueness constraint on the value role. */
function simpleModel(): OrmModel {
  return new ModelBuilder("Graph Test")
    .withEntityType("Customer")
    .withValueType("Name")
    .withBinaryFactType("Customer has Name", {
      role1: { player: "Customer", name: "has" },
      role2: { player: "Name", name: "is of" },
      readings: ["{0} has {1}", "{1} is of {0}"],
      uniqueness: "role1",
    })
    .build();
}

describe("graphOf: references that do not resolve", () => {
  it("fails when a constraint names a role its fact type does not have", () => {
    const model = simpleModel();
    const ft = model.factTypes[0]!;
    ft.addConstraint({ type: "mandatory", roleId: "bogus", id: "c-bogus" });

    const result = graphOf(model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const found = result.unresolved.find((u) => u.missing === "bogus");
    expect(found).toBeDefined();
    if (found?.from.kind !== "constraint") throw new Error("expected a constraint source");
    // The element itself, so a consumer can switch on the constraint's
    // kind and name its fact type without a second lookup.
    expect(found.from.constraint.id).toBe("c-bogus");
    expect(found.from.constraint.type).toBe("mandatory");
    expect(found.from.factType.id).toBe(ft.id);
  });

  it("fails when a role's player does not exist", () => {
    const model = new OrmModel({ name: "Dangling Player" });
    model.addObjectType({ name: "Customer", kind: "entity", referenceMode: "id" });
    model.addFactType({
      name: "Customer has Nothing",
      roles: [
        { name: "has", playerId: model.objectTypes[0]!.id },
        { name: "is of", playerId: "ot-missing" },
      ],
      readings: ["{0} has {1}"],
    }, { skipPlayerValidation: true });

    const result = graphOf(model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolved.some((u) => u.field === "playerId" && u.missing === "ot-missing"))
      .toBe(true);
  });

  // One list, not one exception: a caller fixing a model wants every
  // dangling reference, and validation maps the whole list in one pass.
  it("reports every unresolvable reference, not just the first", () => {
    const model = simpleModel();
    const ft = model.factTypes[0]!;
    ft.addConstraint({ type: "mandatory", roleId: "bogus1", id: "c1" });
    ft.addConstraint({ type: "mandatory", roleId: "bogus2", id: "c2" });

    const result = graphOf(model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.unresolved.map((u) => u.missing).sort()).toEqual(["bogus1", "bogus2"]);
  });

  // Not an unresolvable reference but an ambiguous one, and it defeats
  // totality the same way: an id-keyed index keeps the last writer, so
  // `factTypeOf` would answer confidently for the wrong fact type.
  // structural.ts guards duplicate NAMES, not ids, so nothing else in
  // the repo reports this.
  it("fails when two roles share an id", () => {
    const model = simpleModel();
    const ft = model.factTypes[0]!;
    const dupId = ft.roles[0]!.id;
    model.addFactType({
      name: "Customer also has Name",
      roles: [
        { name: "also has", playerId: ft.roles[0]!.playerId, id: dupId },
        { name: "also is of", playerId: ft.roles[1]!.playerId },
      ],
      readings: ["{0} also has {1}"],
    });

    const result = graphOf(model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const dup = result.unresolved.find((u) => u.field === "id" && u.missing === dupId);
    expect(dup).toBeDefined();
    expect(dup?.from.kind).toBe("role");
  });

  it("does not return a graph when a reference dangles", () => {
    const model = simpleModel();
    model.factTypes[0]!.addConstraint({ type: "mandatory", roleId: "bogus", id: "c" });
    const result = graphOf(model);
    expect("graph" in result).toBe(false);
  });
});

describe("graphOf: a built graph is total", () => {
  it("resolves every role's player and fact type", () => {
    const model = simpleModel();
    const result = graphOf(model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const ft of model.factTypes) {
      for (const role of ft.roles) {
        expect(result.graph.player(role)).toBeDefined();
        expect(result.graph.player(role).id).toBe(role.playerId);
        expect(result.graph.factTypeOf(role).id).toBe(ft.id);
      }
    }
  });

  it("indexes constraints in both directions", () => {
    const model = simpleModel();
    const result = graphOf(model);
    if (!result.ok) throw new Error("expected a graph");

    const ft = model.factTypes[0]!;
    const constraint = ft.constraints[0]!;
    const roles = result.graph.rolesOf(constraint);
    expect(roles.length).toBeGreaterThan(0);
    for (const role of roles) {
      expect(result.graph.constraintsOn(role)).toContain(constraint);
    }
  });

  it("resolves a constraint to roles carrying their player and fact type", () => {
    const model = simpleModel();
    const result = graphOf(model);
    if (!result.ok) throw new Error("expected a graph");

    const resolved = result.graph.resolve(model.factTypes[0]!.constraints[0]!);
    expect(resolved.roles.length).toBeGreaterThan(0);
    for (const r of resolved.roles) {
      expect(r.player.id).toBe(r.role.playerId);
      expect(r.factType.roles.some((x) => x.id === r.role.id)).toBe(true);
    }
    // One binary fact type, so its roles cannot span two.
    expect(resolved.spansFactTypes).toBe(false);
  });

  it("reports spansFactTypes for a constraint whose roles cross fact types", () => {
    const model = new ModelBuilder("Spanning")
      .withEntityType("Customer")
      .withValueType("Name")
      .withValueType("Email")
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        readings: ["{0} has {1}", "{1} is of {0}"],
      })
      .withBinaryFactType("Customer has Email", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Email", name: "is of" },
        readings: ["{0} has {1}", "{1} is of {0}"],
      })
      .build();

    const [ft1, ft2] = model.factTypes;
    ft1!.addConstraint({
      type: "external_uniqueness",
      id: "eu",
      roleIds: [ft1!.roles[1]!.id, ft2!.roles[1]!.id],
    });

    const result = graphOf(model);
    if (!result.ok) throw new Error("expected a graph");
    expect(result.graph.resolve(ft1!.constraints[0]!).spansFactTypes).toBe(true);
  });

  it("reports commonPlayer only when every role shares one", () => {
    const model = simpleModel();
    const result = graphOf(model);
    if (!result.ok) throw new Error("expected a graph");

    // The uniqueness constraint covers one role, so its single player is
    // trivially common.
    const resolved = result.graph.resolve(model.factTypes[0]!.constraints[0]!);
    expect(resolved.commonPlayer).toBeDefined();
  });

  // A constraint's id is OPTIONAL and `addConstraint` does not mint one
  // (only FactType's constructor does), so an index keyed by `c.id`
  // reports "no roles" for a constraint that references real ones, on a
  // graph that built successfully. Found by reviewing this workstream
  // before it opened; it is the silent-[] shape of barwise-928.
  it("resolves roles for a constraint that carries no id", () => {
    const model = simpleModel();
    const ft = model.factTypes[0]!;
    ft.addConstraint({ type: "mandatory", roleId: ft.roles[0]!.id });

    const result = graphOf(model);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const idless = ft.constraints.find((c) => !c.id)!;
    expect(idless).toBeDefined();
    expect(result.graph.rolesOf(idless).map((r) => r.id)).toEqual([ft.roles[0]!.id]);
    expect(result.graph.resolve(idless).roles.length).toBe(1);
  });

  it("carries the constraint and its fact type when the constraint has no id", () => {
    const model = simpleModel();
    const ft = model.factTypes[0]!;
    ft.addConstraint({ type: "mandatory", roleId: "bogus" });

    const result = graphOf(model);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // A constraint's id is optional, so the record carries the constraint
    // and its fact type instead of an id that may not exist.
    const found = result.unresolved.find((u) => u.missing === "bogus");
    if (found?.from.kind !== "constraint") throw new Error("expected a constraint source");
    expect(found.from.constraint.id).toBeUndefined();
    expect(found.from.constraint.type).toBe("mandatory");
    expect(found.from.factType.id).toBe(ft.id);
  });

  it("exposes the adjacency walk and the subtype relation", () => {
    const model = new ModelBuilder("Subtypes")
      .withEntityType("Person")
      .withEntityType("Employee")
      .withValueType("Name")
      .withBinaryFactType("Person has Name", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Name", name: "is of" },
        readings: ["{0} has {1}", "{1} is of {0}"],
      })
      .withSubtypeFact("Employee", "Person")
      .build();

    const result = graphOf(model);
    if (!result.ok) throw new Error("expected a graph");

    const person = model.objectTypes.find((o) => o.name === "Person")!;
    const employee = model.objectTypes.find((o) => o.name === "Employee")!;
    expect(result.graph.subtypesOf(person).map((o) => o.id)).toContain(employee.id);
    expect(result.graph.supertypesOf(employee).map((o) => o.id)).toContain(person.id);
    expect(result.graph.hopsFrom(person).length).toBeGreaterThan(0);
    expect(result.graph.rolesPlayedBy(person).length).toBeGreaterThan(0);
  });

  it("returns an empty list rather than undefined for an object type that plays no role", () => {
    const model = new ModelBuilder("Isolated")
      .withEntityType("Customer")
      .withEntityType("Orphan")
      .withValueType("Name")
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        readings: ["{0} has {1}", "{1} is of {0}"],
      })
      .build();

    const result = graphOf(model);
    if (!result.ok) throw new Error("expected a graph");
    const orphan = model.objectTypes.find((o) => o.name === "Orphan")!;
    expect(result.graph.rolesPlayedBy(orphan)).toEqual([]);
    expect(result.graph.hopsFrom(orphan)).toEqual([]);
  });
});

/**
 * The corpus check the spec's acceptance criterion names.
 *
 * The cases above build models by hand, which proves the accessors work
 * on shapes a test author thought of. This one asserts totality over
 * every model the repository actually ships -- the population the
 * design has to survive, and the one that would expose a reference kind
 * `graphOf` forgot to resolve.
 */
describe("graphOf over the shipped example models", () => {
  const outputDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../../../examples/output");
  const models = readdirSync(outputDir).filter((f) => f.endsWith(".orm.yaml"));

  it("finds models to check", () => {
    // Without this, an empty directory would make every case below pass
    // vacuously -- the reading barwise-906 exists for.
    expect(models.length).toBeGreaterThan(0);
  });

  it.each(models)("builds a total graph for %s", (file) => {
    const model = new OrmYamlSerializer().deserialize(
      readFileSync(resolve(outputDir, file), "utf8"),
    );
    const result = graphOf(model);
    if (!result.ok) {
      throw new Error(
        `graphOf failed on ${file}: ${JSON.stringify(result.unresolved)}`,
      );
    }
    for (const ft of model.factTypes) {
      for (const role of ft.roles) {
        expect(result.graph.player(role)).toBeDefined();
        expect(result.graph.factTypeOf(role)).toBeDefined();
      }
      for (const c of ft.constraints) {
        expect(result.graph.rolesOf(c)).toBeDefined();
        expect(result.graph.resolve(c).roles.length).toBe(roleIdsOf(c).length);
      }
    }
  });
});
