/**
 * Tests for objectified fact type structural validation rules.
 *
 * Validates that the structural rules catch:
 *   - Dangling fact type references (fact type id missing)
 *   - Dangling object type references (object type id missing)
 *   - Non-entity types used as objectification targets
 *   - Duplicate objectification of the same fact type
 *   - Duplicate use of the same object type as objectification target
 *   - Valid objectified fact types produce no diagnostics
 */
import { describe, expect, it } from "vitest";
import { ObjectifiedFactType } from "../../src/model/ObjectifiedFactType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { structuralRules } from "../../src/validation/rules/structural.js";
import { graphFor, unresolvedDiagnostics } from "../helpers/graphFor.js";

describe("objectified fact type structural rules", () => {
  it("produces no diagnostics for a valid objectified fact type", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const marriage = model.addObjectType({
      name: "Marriage",
      kind: "entity",
      referenceMode: "marriage_id",
    });
    const ft = model.addFactType({
      name: "Person marries Person",
      roles: [
        { name: "marries", playerId: person.id },
        { name: "is married to", playerId: person.id },
      ],
      readings: ["{0} marries {1}", "{1} is married to {0}"],
    });

    model.addObjectifiedFactType({
      factTypeId: ft.id,
      objectTypeId: marriage.id,
    });

    const diags = structuralRules(model, graphFor(model));
    const oftDiags = diags.filter((d) => d.ruleId?.startsWith("structural/objectified"));
    expect(oftDiags).toHaveLength(0);
  });

  it("detects dangling fact type reference", () => {
    const model = new OrmModel({ name: "Test" });
    const marriage = model.addObjectType({
      name: "Marriage",
      kind: "entity",
      referenceMode: "marriage_id",
    });

    // Inject an objectified fact type with a nonexistent fact type.
    const badOft = new ObjectifiedFactType({
      factTypeId: "nonexistent-ft",
      objectTypeId: marriage.id,
    });
    (model as any)._objectifiedFactTypes.set(badOft.id, badOft);

    // The check moved into `graphOf`; the diagnostic id did not move
    // with it, because that id is what a consumer reads.
    const diags = unresolvedDiagnostics(model);
    const danglingDiags = diags.filter(
      (d) => d.ruleId === "structural/objectified-dangling-fact-type",
    );
    expect(danglingDiags).toHaveLength(1);
    expect(danglingDiags[0]!.message).toContain("nonexistent-ft");
  });

  it("detects dangling object type reference", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const ft = model.addFactType({
      name: "Person marries Person",
      roles: [
        { name: "marries", playerId: person.id },
        { name: "is married to", playerId: person.id },
      ],
      readings: ["{0} marries {1}", "{1} is married to {0}"],
    });

    // Inject an objectified fact type with a nonexistent object type.
    const badOft = new ObjectifiedFactType({
      factTypeId: ft.id,
      objectTypeId: "nonexistent-ot",
    });
    (model as any)._objectifiedFactTypes.set(badOft.id, badOft);

    const diags = unresolvedDiagnostics(model);
    const danglingDiags = diags.filter(
      (d) => d.ruleId === "structural/objectified-dangling-object-type",
    );
    expect(danglingDiags).toHaveLength(1);
    expect(danglingDiags[0]!.message).toContain("nonexistent-ot");
  });

  it("detects non-entity type used as objectification target", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const date = model.addObjectType({ name: "Date", kind: "value" });
    const ft = model.addFactType({
      name: "Person marries Person",
      roles: [
        { name: "marries", playerId: person.id },
        { name: "is married to", playerId: person.id },
      ],
      readings: ["{0} marries {1}", "{1} is married to {0}"],
    });

    // Inject an objectified fact type targeting a value type.
    const badOft = new ObjectifiedFactType({
      factTypeId: ft.id,
      objectTypeId: date.id,
    });
    (model as any)._objectifiedFactTypes.set(badOft.id, badOft);

    const diags = structuralRules(model, graphFor(model));
    const notEntityDiags = diags.filter(
      (d) => d.ruleId === "structural/objectified-not-entity",
    );
    expect(notEntityDiags).toHaveLength(1);
    expect(notEntityDiags[0]!.message).toContain("value type");
  });

  it("detects duplicate objectification of the same fact type", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const marriage = model.addObjectType({
      name: "Marriage",
      kind: "entity",
      referenceMode: "marriage_id",
    });
    const union = model.addObjectType({
      name: "Union",
      kind: "entity",
      referenceMode: "union_id",
    });
    const ft = model.addFactType({
      name: "Person marries Person",
      roles: [
        { name: "marries", playerId: person.id },
        { name: "is married to", playerId: person.id },
      ],
      readings: ["{0} marries {1}", "{1} is married to {0}"],
    });

    // Add a valid objectification, then inject a duplicate via the internal map.
    model.addObjectifiedFactType({
      factTypeId: ft.id,
      objectTypeId: marriage.id,
    });
    const dupOft = new ObjectifiedFactType({
      factTypeId: ft.id,
      objectTypeId: union.id,
    });
    (model as any)._objectifiedFactTypes.set(dupOft.id, dupOft);

    const diags = structuralRules(model, graphFor(model));
    const dupDiags = diags.filter(
      (d) => d.ruleId === "structural/duplicate-objectification",
    );
    expect(dupDiags).toHaveLength(1);
  });

  it("detects duplicate use of the same object type as objectification", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const marriage = model.addObjectType({
      name: "Marriage",
      kind: "entity",
      referenceMode: "marriage_id",
    });
    const ft1 = model.addFactType({
      name: "Person marries Person",
      roles: [
        { name: "marries", playerId: person.id },
        { name: "is married to", playerId: person.id },
      ],
      readings: ["{0} marries {1}", "{1} is married to {0}"],
    });
    const ft2 = model.addFactType({
      name: "Person employs Person",
      roles: [
        { name: "employs", playerId: person.id },
        { name: "is employed by", playerId: person.id },
      ],
      readings: ["{0} employs {1}", "{1} is employed by {0}"],
    });

    // Add a valid objectification, then inject another targeting the same entity.
    model.addObjectifiedFactType({
      factTypeId: ft1.id,
      objectTypeId: marriage.id,
    });
    const dupOft = new ObjectifiedFactType({
      factTypeId: ft2.id,
      objectTypeId: marriage.id,
    });
    (model as any)._objectifiedFactTypes.set(dupOft.id, dupOft);

    const diags = structuralRules(model, graphFor(model));
    const dupTargetDiags = diags.filter(
      (d) => d.ruleId === "structural/duplicate-objectification-target",
    );
    expect(dupTargetDiags).toHaveLength(1);
  });
});
