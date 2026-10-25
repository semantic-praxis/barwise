/**
 * A mandatory role on a unary, ternary or wider fact type names every
 * player (nary-mandatory-verbalization.spec.md). It used to write the
 * constrained role's player into every slot: "Each Appointment must:
 * Appointment is for Appointment with Appointment ...".
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ConstraintVerbalizer } from "../../src/verbalization/ConstraintVerbalizer.js";

/** Customer on behalf of Organization signs Agreement, with the given readings. */
function signs(readings: string[], mandatoryRole: "rc" | "ro" | "ra") {
  return signsVerbalized(readings, mandatoryRole).map((v) => v.text);
}

function signsVerbalized(readings: string[], mandatoryRole: "rc" | "ro" | "ra") {
  const model = new OrmModel({ name: "Test" });
  model.addObjectType({ id: "c", name: "Customer", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "o", name: "Organization", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "a", name: "Agreement", kind: "entity", referenceMode: "nr" });
  const ft = model.addFactType({
    id: "ft",
    name: "Customer on behalf of Organization signs Agreement",
    roles: [
      { id: "rc", name: "signs", playerId: "c" },
      { id: "ro", name: "is represented in", playerId: "o" },
      { id: "ra", name: "is signed in", playerId: "a" },
    ],
    readings,
    constraints: [{ type: "mandatory", roleId: mandatoryRole }],
  });
  return new ConstraintVerbalizer().verbalizeAll(ft.id, model);
}

describe("mandatory on a non-binary fact type", () => {
  it("reads from a reading that opens with the constrained role", () => {
    expect(signs(["{0} on behalf of {1} signs {2}"], "rc")).toEqual([
      "Each Customer on behalf of some Organization signs some Agreement.",
    ]);
  });

  it("prefers a later reading that opens with the role over the first", () => {
    expect(signs(["{0} on behalf of {1} signs {2}", "{2} is signed by {0} for {1}"], "ra"))
      .toEqual(["Each Agreement is signed by some Customer for some Organization."]);
  });

  it("names a placeholder the reading repeats with 'that' after its first mention", () => {
    // binary-reverse-reading-verbalization.spec.md: a second "some" would
    // introduce a second Organization.
    expect(signs(["{0} on behalf of {1} signs {2} for {1}"], "ra")).toEqual([
      "For each Agreement, some Customer on behalf of some Organization signs that Agreement for that Organization.",
    ]);
  });

  it("frames the first reading with 'For each' when no reading opens with the role", () => {
    expect(signs(["{0} on behalf of {1} signs {2}"], "ra")).toEqual([
      "For each Agreement, some Customer on behalf of some Organization signs that Agreement.",
    ]);
    expect(signs(["{0} on behalf of {1} signs {2}"], "ro")).toEqual([
      "For each Organization, some Customer on behalf of that Organization signs some Agreement.",
    ]);
  });

  it("places a hyphen-bound lead after the quantifier, on either kind of role", () => {
    expect(signs(["new- {0} on behalf of {1} signs draft- {2}"], "rc")).toEqual([
      "Each new Customer on behalf of some Organization signs some draft Agreement.",
    ]);
    expect(signs(["{0} on behalf of {1} signs draft- {2}"], "ra")).toEqual([
      "For each draft Agreement, some Customer on behalf of some Organization signs that draft Agreement.",
    ]);
  });

  it("supplies the space a flush placeholder leaves out, before a word in any script", () => {
    expect(signs(["{0} on behalf of{1}signs {2}"], "rc")).toEqual([
      "Each Customer on behalf of some Organization signs some Agreement.",
    ]);
    expect(signs(["{0} handelt für{1}über {2}"], "rc")).toEqual([
      "Each Customer handelt für some Organization über some Agreement.",
    ]);
    expect(signs(["{0} signs {2}{1}"], "rc")).toEqual([
      "Each Customer signs some Agreement some Organization.",
    ]);
  });

  it("drops whitespace at the end of the reading before the period", () => {
    expect(signs(["{0} on behalf of {1} signs {2} "], "ra")).toEqual([
      "For each Agreement, some Customer on behalf of some Organization signs that Agreement.",
    ]);
    expect(signs(["{0} on behalf of {1} signs {2} for good "], "rc")).toEqual([
      "Each Customer on behalf of some Organization signs some Agreement for good.",
    ]);
  });

  it("refers back to the subject with 'that' where its placeholder recurs", () => {
    expect(signs(["{0} on behalf of {1} signs {2} for {0}"], "rc")).toEqual([
      "Each Customer on behalf of some Organization signs some Agreement for that Customer.",
    ]);
  });

  it("marks the quantifiers as keywords and points each reference at its own player", () => {
    const [v] = signsVerbalized(["{0} on behalf of {1} signs {2}"], "ra");
    expect(v?.segments.map((seg) => [seg.kind, seg.text, seg.elementId])).toEqual([
      ["keyword", "For each ", undefined],
      ["object_type_ref", "Agreement", "a"],
      ["text", ", ", undefined],
      ["keyword", "some ", undefined],
      ["object_type_ref", "Customer", "c"],
      ["text", " on behalf of ", undefined],
      ["keyword", "some ", undefined],
      ["object_type_ref", "Organization", "o"],
      ["text", " signs ", undefined],
      ["keyword", "that ", undefined],
      ["object_type_ref", "Agreement", "a"],
      ["text", ".", undefined],
    ]);
  });

  it("says a unary mandatory as its reading", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    const ft = model.addFactType({
      id: "ft",
      name: "Person breathes",
      roles: [{ id: "rp", name: "breathes", playerId: "p" }],
      readings: ["{0} breathes"],
      constraints: [{ type: "mandatory", roleId: "rp" }],
    });
    expect(new ConstraintVerbalizer().verbalizeAll(ft.id, model).map((v) => v.text)).toEqual([
      "Each Person breathes.",
    ]);
  });
});
