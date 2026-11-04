/**
 * A constraint over subtypes (orm-format-3, Open decision 2 and WS4b):
 * an exclusion, exclusive-or or disjunctive mandatory whose operand is a
 * supertype's subtype facts rather than roles. Each capability that reads
 * the three kinds must see one, rather than reading its missing roles as
 * "touches nothing".
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeModels } from "../../src/diff/ModelMerge.js";
import { generateModelLineage } from "../../src/lineage/generate.js";
import type { ExternalConstraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { RULE_ID } from "../../src/validation/ruleId.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";

/** Person with subtypes Male and Female, and optionally Child. */
function people(subtypes = ["Male", "Female"]) {
  const model = new OrmModel({ name: "People" });
  const person = model.addObjectType({
    id: "p",
    name: "Person",
    kind: "entity",
    referenceMode: "id",
  });
  const sf: Record<string, string> = {};
  for (const name of subtypes) {
    const ot = model.addObjectType({ id: name, name, kind: "entity", referenceMode: "id" });
    sf[name] = model.addSubtypeFact({ id: `sf-${name}`, subtypeId: ot.id, supertypeId: person.id })
      .id;
  }
  return { model, sf };
}

const over = (
  type: "exclusion" | "exclusive_or" | "disjunctive_mandatory",
  ids: string[],
  id = `c-${type}`,
): ExternalConstraint => ({ id, type, subtypeFactIds: ids });

const verbalize = (model: OrmModel, id: string) =>
  new Verbalizer().verbalizeModel(model).find((v) => v.sourceElementId === id)?.text;

const fired = (model: OrmModel) => new ValidationEngine().validate(model).map((d) => d.ruleId);

describe("a constraint over subtypes", () => {
  it("verbalizes each kind over the supertype and its subtypes", () => {
    const { model, sf } = people();
    const ids = [sf["Male"]!, sf["Female"]!];
    for (const c of [over("exclusion", ids), over("exclusive_or", ids)]) model.addConstraint(c);
    model.addConstraint(over("disjunctive_mandatory", ids));
    expect(verbalize(model, "c-exclusion")).toBe("Each Person is at most one of: Male, Female.");
    expect(verbalize(model, "c-exclusive_or")).toBe(
      "Each Person is exactly one of: Male, Female.",
    );
    expect(verbalize(model, "c-disjunctive_mandatory")).toBe(
      "Each Person is at least one of: Male, Female.",
    );
  });

  it("verbalizes a disjunctive mandatory over one subtype as a plain rule", () => {
    const { model, sf } = people(["Male"]);
    model.addConstraint(over("disjunctive_mandatory", [sf["Male"]!]));
    expect(verbalize(model, "c-disjunctive_mandatory")).toBe("Each Person is a Male.");
  });

  it("validates clean when well formed", () => {
    const { model, sf } = people();
    model.addConstraint(over("exclusive_or", [sf["Male"]!, sf["Female"]!]));
    const subtypeRules = fired(model).filter((r) => r.includes("subtype-constraint"));
    expect(subtypeRules).toEqual([]);
  });

  it("needs two subtypes to exclude, and one to be exhaustive over", () => {
    const { model, sf } = people(["Male"]);
    model.addConstraint(over("exclusion", [sf["Male"]!]));
    model.addConstraint(over("disjunctive_mandatory", [sf["Male"]!]));
    expect(fired(model).filter((r) => r === RULE_ID.subtypeConstraintTooFewSubtypes))
      .toHaveLength(1);
  });

  it("refuses subtype facts of two supertypes", () => {
    const { model, sf } = people();
    const animal = model.addObjectType({
      id: "a",
      name: "Animal",
      kind: "entity",
      referenceMode: "id",
    });
    const dog = model.addObjectType({ id: "d", name: "Dog", kind: "entity", referenceMode: "id" });
    const sfDog = model.addSubtypeFact({ subtypeId: dog.id, supertypeId: animal.id });
    model.addConstraint(over("exclusion", [sf["Male"]!, sfDog.id]));
    expect(fired(model)).toContain(RULE_ID.subtypeConstraintMixedSupertypes);
  });

  it("reports a subtype fact id the model does not have", () => {
    const { model, sf } = people();
    model.addConstraint(over("exclusion", [sf["Male"]!, "sf-gone"]));
    const diagnostics = new ValidationEngine().validate(model)
      .filter((d) => d.ruleId === RULE_ID.subtypeConstraintUnknownSubtypeFact);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]!.message).toContain("sf-gone");
  });

  it("is listed among the constraints touching nothing only when none of its subtype facts resolve", () => {
    const { model, sf } = people();
    model.addConstraint(over("exclusion", [sf["Male"]!, sf["Female"]!]));
    expect(model.constraintsTouchingNone()).toEqual([]);
    const dangling = over("exclusion", ["sf-gone", "sf-also-gone"], "c-dangling");
    model.addConstraint(dangling);
    expect(model.constraintsTouchingNone()).toEqual([dangling]);
  });

  it("is a lineage source of the supertype and each subtype it names", () => {
    const { model, sf } = people();
    model.addConstraint(over("exclusive_or", [sf["Male"]!, sf["Female"]!]));
    const sourced = generateModelLineage(model)
      .filter((e) => e.sources.some((s) => s.elementId === "c-exclusive_or"))
      .map((e) => e.artifact);
    expect(sourced.sort()).toEqual(["Female", "Male", "Person"]);
  });

  it("diffs as a constraint, labelled by the subtype relationships it names", () => {
    const existing = people().model;
    const { model: incoming, sf } = people();
    incoming.addConstraint(over("exclusive_or", [sf["Male"]!, sf["Female"]!]));
    const delta = diffModels(existing, incoming).deltas.find((d) => d.elementType === "constraint");
    expect(delta).toMatchObject({
      kind: "added",
      constraintType: "exclusive_or",
      roles: ["Male is a Person", "Female is a Person"],
    });
  });

  it("merges in over the merged model's subtype facts when the incoming model adds both", () => {
    const existing = new OrmModel({ name: "People" });
    existing.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    const { model: incoming, sf } = people();
    incoming.addConstraint(over("exclusive_or", [sf["Male"]!, sf["Female"]!]));
    const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
    const merged = mergeModels(
      existing,
      incoming,
      { deltas, matching: "id-first", recognizeRenames: false },
      new Set(deltas.map((_, i) => i)),
    );
    expect(merged.constraints).toHaveLength(1);
    const [xor] = merged.constraints;
    const named = (xor!.subtypeFactIds ?? []).map((id) => {
      const fact = merged.getSubtypeFact(id);
      return fact && merged.getObjectType(fact.subtypeId)?.name;
    });
    expect(named).toEqual(["Male", "Female"]);
  });

  it("keeps what still holds when the merge leaves one of its subtype facts out", () => {
    // The incoming model drops Other; the reviewer takes that and keeps the
    // existing exclusive-or. No Person is both Male and Female still holds.
    const { model: existing, sf } = people(["Male", "Female", "Other"]);
    existing.addConstraint(over("exclusive_or", [sf["Male"]!, sf["Female"]!, sf["Other"]!]));
    const { model: incoming } = people();
    incoming.addConstraint(over("exclusive_or", [sf["Male"]!, sf["Female"]!]));
    const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
    const accepted = new Set(
      deltas.flatMap((d, i) => (d.elementType === "subtype_fact" ? [i] : [])),
    );
    const merged = mergeModels(existing, incoming, {
      deltas,
      matching: "id-first",
      recognizeRenames: false,
    }, accepted);
    expect(merged.constraints).toMatchObject([
      { type: "exclusion", subtypeFactIds: [sf["Male"], sf["Female"]] },
    ]);
  });

  it("counts a subtype named twice once", () => {
    const { model, sf } = people();
    model.addConstraint(over("exclusion", [sf["Male"]!, sf["Male"]!]));
    expect(fired(model)).toContain(RULE_ID.subtypeConstraintTooFewSubtypes);
  });

  it("with no subtype facts at all is still over subtypes, saved and reloaded as it is", () => {
    // Refusing the reload would lose the constraint validation reports.
    const { model } = people();
    model.addConstraint(over("exclusion", []));
    expect(fired(model)).toContain(RULE_ID.subtypeConstraintTooFewSubtypes);
    const serializer = new OrmYamlSerializer();
    const again = serializer.deserialize(serializer.serialize(model));
    expect(again.constraints).toEqual(model.constraints);
    expect(fired(again)).toContain(RULE_ID.subtypeConstraintTooFewSubtypes);
  });

  it("stays out of the merge when its subtype facts are rejected", () => {
    const existing = new OrmModel({ name: "People" });
    existing.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    const { model: incoming, sf } = people();
    incoming.addConstraint(over("exclusive_or", [sf["Male"]!, sf["Female"]!]));
    const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
    const accepted = new Set(
      deltas.flatMap((d, i) => (d.elementType === "subtype_fact" ? [] : [i])),
    );
    const merged = mergeModels(existing, incoming, {
      deltas,
      matching: "id-first",
      recognizeRenames: false,
    }, accepted);
    expect(merged.constraints).toEqual([]);
  });
});
