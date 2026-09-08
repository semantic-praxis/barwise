/**
 * What WS2 is for: an incoming model's new subtype facts and
 * objectifications now reach the merged model.
 *
 * Before this, `diffModels` emitted deltas for three element kinds and
 * `mergeModels` carried the other four through from the EXISTING model
 * unchanged (barwise-937's fix). That stopped the data loss and left
 * the quieter half of the defect: carried means carried, so an incoming
 * model's new subtype fact never arrived no matter what a reviewer
 * accepted, and nothing reported it -- a merge that keeps the existing
 * subtype facts looks exactly like a merge where they did not change.
 *
 * These tests fail against that behaviour and pass against this one,
 * which is the only way to tell the two apart from the outside.
 */

import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/** Two entity types, and optionally the subtype fact relating them. */
function model(withSubtype: boolean, providesIdentification = true) {
  const m = new OrmModel({ name: "M" });
  const employee = m.addObjectType({
    name: "Employee",
    kind: "entity",
    referenceMode: "employee_nr",
  });
  const manager = m.addObjectType({
    name: "Manager",
    kind: "entity",
    referenceMode: "employee_nr",
  });
  if (withSubtype) {
    m.addSubtypeFact({
      subtypeId: manager.id,
      supertypeId: employee.id,
      providesIdentification,
    });
  }
  return m;
}

/** Every index in the diff, i.e. accept the lot. */
const all = (n: number) => new Set(Array.from({ length: n }, (_, i) => i));

describe("a subtype fact the incoming model adds", () => {
  it("merges in when its delta is accepted", () => {
    const existing = model(false);
    const incoming = model(true);
    const { deltas } = diffModels(existing, incoming);

    const added = deltas.find((d) => d.elementType === "subtype_fact");
    expect(added?.kind).toBe("added");

    const merged = mergeModels(existing, incoming, deltas, all(deltas.length));
    expect(merged.subtypeFacts).toHaveLength(1);
    expect(merged.getObjectType(merged.subtypeFacts[0]!.subtypeId)?.name).toBe("Manager");
  });

  it("stays out when its delta is rejected", () => {
    const existing = model(false);
    const incoming = model(true);
    const { deltas } = diffModels(existing, incoming);

    const merged = mergeModels(existing, incoming, deltas, new Set());
    expect(merged.subtypeFacts).toEqual([]);
  });
});

describe("a subtype fact the incoming model changes", () => {
  it("reports providesIdentification as breaking, because it moves the primary key", () => {
    // RelationalMapper gives the subtype's table the SUPERTYPE's primary
    // key when this is true and its own when false, so the change alters
    // the shape a consumer binds to rather than which populations are
    // legal. That is the one field of the four that is not caution.
    const { deltas } = diffModels(model(true, true), model(true, false));
    const modified = deltas.find((d) => d.elementType === "subtype_fact");

    expect(modified?.kind).toBe("modified");
    expect(modified?.changeDescriptions).toEqual(["provides identification: true -> false"]);
    expect(modified?.breakingLevel).toBe("breaking");
  });

  it("takes the incoming content and keeps the existing id when accepted", () => {
    const existing = model(true, true);
    const incoming = model(true, false);
    const existingId = existing.subtypeFacts[0]!.id;
    const { deltas } = diffModels(existing, incoming);

    const merged = mergeModels(existing, incoming, deltas, all(deltas.length));
    expect(merged.subtypeFacts).toHaveLength(1);
    // The id survives so anything holding it still resolves; the content
    // is the incoming model's.
    expect(merged.subtypeFacts[0]!.id).toBe(existingId);
    expect(merged.subtypeFacts[0]!.providesIdentification).toBe(false);
  });

  it("keeps the existing content when rejected", () => {
    const existing = model(true, true);
    const incoming = model(true, false);
    const { deltas } = diffModels(existing, incoming);

    const merged = mergeModels(existing, incoming, deltas, new Set());
    expect(merged.subtypeFacts).toHaveLength(1);
    expect(merged.subtypeFacts[0]!.providesIdentification).toBe(true);
  });
});

describe("an objectified fact type", () => {
  /** A binary fact type, optionally objectified by an entity type. */
  function objectified(withObjectification: boolean) {
    const m = new OrmModel({ name: "M" });
    const student = m.addObjectType({
      name: "Student",
      kind: "entity",
      referenceMode: "student_nr",
    });
    const course = m.addObjectType({ name: "Course", kind: "entity", referenceMode: "code" });
    const enrolment = m.addObjectType({
      name: "Enrolment",
      kind: "entity",
      referenceMode: "enrolment_nr",
    });
    const ft = m.addFactType({
      name: "StudentTakesCourse",
      roles: [{ name: "taker", playerId: student.id }, { name: "taken", playerId: course.id }],
      readings: ["{0} takes {1}"],
    });
    if (withObjectification) {
      m.addObjectifiedFactType({ factTypeId: ft.id, objectTypeId: enrolment.id });
    }
    return m;
  }

  it("merges in when accepted, and never reports as modified", () => {
    const existing = objectified(false);
    const incoming = objectified(true);
    const { deltas } = diffModels(existing, incoming);

    const oft = deltas.find((d) => d.elementType === "objectified_fact_type");
    expect(oft?.kind).toBe("added");
    // It carries nothing beyond its two references, so two that match
    // are equal by construction. The delta type forbids "modified"; this
    // asserts the diff never tries to produce one.
    expect(deltas.every((d) => d.elementType !== "objectified_fact_type" || d.kind !== "modified"))
      .toBe(true);

    const merged = mergeModels(existing, incoming, deltas, all(deltas.length));
    expect(merged.objectifiedFactTypes).toHaveLength(1);
  });

  it("stays out when rejected", () => {
    const existing = objectified(false);
    const incoming = objectified(true);
    const { deltas } = diffModels(existing, incoming);

    const merged = mergeModels(existing, incoming, deltas, new Set());
    expect(merged.objectifiedFactTypes).toEqual([]);
  });
});

/**
 * The merge must never throw, because a throw is not a degraded merge --
 * it is no merge at all. `mergeAndValidate` catches it and returns a
 * null model, so one unaddable element takes the whole result with it.
 *
 * Every case below was found by review rather than by writing the
 * feature, and every one of them reproduced against the first draft of
 * WS2. They are the reason `addableSubtypeFact` and
 * `addableObjectification` mirror every guard the model enforces rather
 * than the two that seemed obvious.
 */
describe("the merge survives states the model refuses", () => {
  /**
   * Two entity types and the subtype fact relating them, with FIXED ids.
   *
   * Id-stability is the trigger and it took a second attempt to find: a
   * first version of this fixture minted fresh UUIDs per model, so the
   * renamed supertype resolved to a different merged object type and the
   * pair never collided -- the test passed with the guard removed, which
   * is a guard that cannot fail. An `.orm.yaml` edited on disk keeps its
   * ids, so this is the shape the defect actually takes.
   */
  function withSupertype(supertypeName: string) {
    const m = new OrmModel({ name: "M" });
    m.addObjectType({ id: "ot-sup", name: supertypeName, kind: "entity", referenceMode: "nr" });
    m.addObjectType({ id: "ot-mgr", name: "Manager", kind: "entity", referenceMode: "nr" });
    m.addSubtypeFact({ id: "sf-1", subtypeId: "ot-mgr", supertypeId: "ot-sup" });
    return m;
  }

  it("does not throw when a rejected removal and an accepted addition name the same pair", () => {
    // A supertype rename produces removed + added. Accepting the
    // addition while rejecting the removal asks for the same
    // (subtype, supertype) twice, which addSubtypeFact rejects as a
    // duplicate relationship.
    const existing = withSupertype("Employee");
    const incoming = withSupertype("Staff");
    const { deltas } = diffModels(existing, incoming);

    const accepted = new Set(
      deltas.map((d, i) => (d.kind === "added" ? i : -1)).filter((i) => i >= 0),
    );
    expect(() => mergeModels(existing, incoming, deltas, accepted)).not.toThrow();
  });

  it("does not evict a subtype fact whose id another one already took", () => {
    // Same subtype-fact id, DIFFERENT pair, so the duplicate-pair guard
    // does not fire and only the id guard stands here. Without it the
    // merged model's Map overwrites and the Manager relationship
    // vanishes with no error at all -- one subtype fact where two were
    // asked for.
    function sameIdDifferentPair(subtypeName: string) {
      const m = new OrmModel({ name: "M" });
      m.addObjectType({ id: "ot-sup", name: "Employee", kind: "entity", referenceMode: "nr" });
      m.addObjectType({
        id: `ot-${subtypeName}`,
        name: subtypeName,
        kind: "entity",
        referenceMode: "nr",
      });
      m.addSubtypeFact({ id: "sf-1", subtypeId: `ot-${subtypeName}`, supertypeId: "ot-sup" });
      return m;
    }

    const existing = sameIdDifferentPair("Manager");
    const incoming = sameIdDifferentPair("Director");
    const { deltas } = diffModels(existing, incoming);
    const accepted = new Set(
      deltas.map((d, i) => (d.kind === "added" ? i : -1)).filter((i) => i >= 0),
    );

    const merged = mergeModels(existing, incoming, deltas, accepted);
    expect(merged.subtypeFacts).toHaveLength(2);
    expect(new Set(merged.subtypeFacts.map((sf) => sf.id)).size).toBe(2);
  });

  it("keeps both subtype facts distinct when a rename collides their ids", () => {
    // Both models name their subtype fact `sf-1`. The merged model keys
    // by id in a Map, and `set` overwrites without complaint, so
    // reusing the id where one is already present is a silent loss
    // rather than an error.
    const existing = withSupertype("Employee");
    const incoming = withSupertype("Staff");
    const { deltas } = diffModels(existing, incoming);

    // Reject the removals, accept the additions: both subtype facts
    // want to be in the result, and both want to be `sf-1`.
    const accepted = new Set(
      deltas.map((d, i) => (d.kind === "added" ? i : -1)).filter((i) => i >= 0),
    );
    const merged = mergeModels(existing, incoming, deltas, accepted);
    const ids = merged.subtypeFacts.map((sf) => sf.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not throw when two objectifications would claim one fact type", () => {
    function objectifiedBy(entityName: string) {
      const m = new OrmModel({ name: "M" });
      const s = m.addObjectType({ name: "Student", kind: "entity", referenceMode: "nr" });
      const c = m.addObjectType({ name: "Course", kind: "entity", referenceMode: "code" });
      const e = m.addObjectType({ name: entityName, kind: "entity", referenceMode: "nr" });
      const ft = m.addFactType({
        name: "StudentTakesCourse",
        roles: [{ name: "taker", playerId: s.id }, { name: "taken", playerId: c.id }],
        readings: ["{0} takes {1}"],
      });
      m.addObjectifiedFactType({ factTypeId: ft.id, objectTypeId: e.id });
      return m;
    }

    // Renaming the objectifying entity gives removed + added on the same
    // fact type. addObjectifiedFactType allows at most one per fact type.
    const existing = objectifiedBy("Enrolment");
    const incoming = objectifiedBy("Registration");
    const { deltas } = diffModels(existing, incoming);

    const accepted = new Set(
      deltas.map((d, i) => (d.kind === "added" ? i : -1)).filter((i) => i >= 0),
    );
    expect(() => mergeModels(existing, incoming, deltas, accepted)).not.toThrow();
  });
});
