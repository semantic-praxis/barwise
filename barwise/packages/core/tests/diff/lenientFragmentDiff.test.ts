/**
 * What a lenient fragment does to a diff, and what it should do.
 *
 * `barwise merge` and the MCP merge tool accept an incoming model that
 * references object and fact types it does not define -- a fragment,
 * loaded with `lenient: true` so `ValidationEngine` reports the
 * dangling references instead of the loader throwing. Four of the six
 * diffed element kinds resolve a reference indirectly, and each one
 * used to resolve it against the model the element came from alone:
 *
 *   - a subtype fact and an objectification are KEYED by the pair they
 *     relate, so an unresolved endpoint keys them by UUID and they
 *     match nothing -- an unchanged relationship read as a removal plus
 *     an addition, both labelled with ids;
 *   - a fact type matches by its own name but COMPARES its role
 *     players by name, so an unchanged fact type read as modified,
 *     "role 0: player Person -> 854db2e9-...";
 *   - a population is grouped by its fact type's name and keys its
 *     tuples by that fact type's roles, so it grouped by UUID and
 *     ordered its tuples against an empty role list.
 *
 * Synonym detection reads the same names and stopped offering a renamed
 * fact type as a candidate, which is the one place the defect made the
 * diff say LESS rather than more.
 *
 * barwise-957 named the first two of those. Its note said the kinds
 * that match by their own name were unaffected "because a name is
 * always present on the element itself"; the fact-type and population
 * tests here are what disproved that -- the element's own name is
 * present, and the names it resolves indirectly are not.
 *
 * The fix is one rule applied at every such site: resolve against the
 * model the element came from, then against the other model of the
 * diff, because those two are the only places an id can be defined. An
 * element neither model can resolve is skipped where it is pair-keyed,
 * since no acceptance set can produce a merged model that holds it.
 *
 * Every fixture below fixes its ids, because a fragment carved from a
 * model on disk carries that model's ids -- an id-stable pair is the
 * condition under which this defect surfaces at all.
 */

import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeAndValidate, mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";

const lenient = { skipPlayerValidation: true };

/** An empty model that will be filled with references it does not define. */
const fragment = () => new OrmModel({ name: "M" });

/** Three entity types and nothing else. */
function objectTypes(): OrmModel {
  const m = new OrmModel({ name: "M" });
  m.addObjectType({ id: "ot-emp", name: "Employee", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: "ot-mgr", name: "Manager", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: "ot-dep", name: "Department", kind: "entity", referenceMode: "code" });
  return m;
}

/**
 * The Employee-Department fact type, added leniently so the same call
 * works on a model that defines those object types and on one that does
 * not. `skipPlayerValidation` only skips a check; it changes nothing
 * about the element when the players are in fact present.
 */
function addWorks(m: OrmModel, id = "ft-works", name = "EmployeeWorksInDepartment"): OrmModel {
  m.addFactType(
    {
      id,
      name,
      roles: [
        { id: "r-worker", name: "worker", playerId: "ot-emp" },
        { id: "r-place", name: "workplace", playerId: "ot-dep" },
      ],
      readings: ["{0} works in {1}", "{1} employs {0}"],
    },
    lenient,
  );
  return m;
}

/** Three entity types, one fact type between two of them. */
const base = (): OrmModel => addWorks(objectTypes());

const subtypeDeltas = (a: OrmModel, b: OrmModel) =>
  diffModels(a, b).deltas.filter((d) => d.elementType === "subtype_fact");

describe("a subtype fact in a lenient fragment", () => {
  it("matches the existing one instead of reading as removed plus added", () => {
    const existing = base();
    existing.addSubtypeFact({ id: "sf-1", subtypeId: "ot-mgr", supertypeId: "ot-emp" });

    const incoming = fragment();
    incoming.addSubtypeFact({ id: "sf-1", subtypeId: "ot-mgr", supertypeId: "ot-emp" }, lenient);

    const deltas = subtypeDeltas(existing, incoming);
    expect(deltas.map((d) => d.kind)).toEqual(["unchanged"]);
  });

  it("names its endpoints as the existing model knows them", () => {
    const existing = base();
    const incoming = fragment();
    incoming.addSubtypeFact({ id: "sf-2", subtypeId: "ot-mgr", supertypeId: "ot-emp" }, lenient);

    const deltas = subtypeDeltas(existing, incoming);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.kind).toBe("added");
    expect(deltas[0]!.subtype.name).toBe("Manager");
    expect(deltas[0]!.supertype.name).toBe("Employee");
  });

  it("reaches the merged model when that delta is accepted", () => {
    const existing = base();
    const incoming = fragment();
    incoming.addSubtypeFact({ id: "sf-2", subtypeId: "ot-mgr", supertypeId: "ot-emp" }, lenient);

    const { deltas } = diffModels(existing, incoming);
    // The default review policy for a fragment: take what it adds, keep
    // what it does not mention. Accepting the removals instead would
    // empty the model, which is the fragment's own doing and not this
    // rule's business.
    const accepted = new Set(
      deltas.map((d, i) => (d.kind === "added" ? i : -1)).filter((i) => i >= 0),
    );
    const merged = mergeModels(existing, incoming, deltas, accepted);
    expect(merged.subtypeFacts).toHaveLength(1);
    expect(merged.getObjectType(merged.subtypeFacts[0]!.subtypeId)?.name).toBe("Manager");
  });

  // THE FOUR TESTS BELOW ASSERTED THE OPPOSITE UNTIL barwise-997.
  //
  // They pinned a skip: a pair-keyed element neither model resolves
  // produced no delta at all, on the ground that the merged model could
  // not hold it. `OrmModel` holds it under `skipPlayerValidation` -- the
  // very option the lenient load used to put it in the fragment -- and
  // the `structural/subtype-dangling-*` rules report it at error
  // severity. So the skip was deleting the evidence of a dangling
  // reference rather than sparing a reviewer a false choice, which is
  // the defect barwise-997 established on populations.
  //
  // Inverted rather than deleted, so the record shows a decision that
  // changed and not a case that stopped being covered.

  it("is reported when neither model defines its endpoints", () => {
    const existing = base();
    const incoming = fragment();
    incoming.addSubtypeFact(
      { id: "sf-3", subtypeId: "ot-nowhere", supertypeId: "ot-elsewhere" },
      lenient,
    );

    expect(subtypeDeltas(existing, incoming).map((d) => d.kind)).toEqual(["added"]);
  });

  it.each([
    ["its subtype", "ot-nowhere", "ot-emp"],
    ["its supertype", "ot-mgr", "ot-nowhere"],
  ])("is reported when %s alone is undefined", (_which, subtypeId, supertypeId) => {
    // One end is enough to make it dangling, and two cases rather than
    // one because a check of the subtype alone passes the first and not
    // the second.
    const existing = base();
    const incoming = fragment();
    incoming.addSubtypeFact({ id: "sf-5", subtypeId, supertypeId }, lenient);

    expect(subtypeDeltas(existing, incoming).map((d) => d.kind)).toEqual(["added"]);
  });

  it("names its endpoints from the incoming model when the EXISTING side is the fragment", () => {
    // The rule is symmetric, and so is the fixture: `barwise merge`
    // makes the incoming side the lenient one, but the existing side
    // resolves through its own call and nothing makes a full model the
    // only thing that can sit there.
    const existing = fragment();
    existing.addSubtypeFact({ id: "sf-1", subtypeId: "ot-mgr", supertypeId: "ot-emp" }, lenient);

    const incoming = base();
    incoming.addSubtypeFact({ id: "sf-1", subtypeId: "ot-mgr", supertypeId: "ot-emp" });

    const deltas = subtypeDeltas(existing, incoming);
    expect(deltas.map((d) => d.kind)).toEqual(["unchanged"]);
    expect(deltas[0]!.subtype.name).toBe("Manager");
    expect(deltas[0]!.supertype.name).toBe("Employee");
  });

  it("is reported on the existing side too, for the same reason", () => {
    // An existing model can be lenient as well -- a `.orm.yaml` edited
    // on disk into a dangling reference -- and the mirror case gets the
    // mirror answer.
    const existing = base();
    existing.addSubtypeFact(
      { id: "sf-4", subtypeId: "ot-nowhere", supertypeId: "ot-elsewhere" },
      lenient,
    );

    expect(subtypeDeltas(existing, base()).map((d) => d.kind)).toEqual(["removed"]);
  });

  it("reaches the merged model and is REPORTED there, rather than vanishing", () => {
    // This test is the one that mattered. It used to assert the merged
    // model "cannot hold a relationship between two object types that
    // do not exist", and stated that claim as the ground for the skip.
    // The claim is false: `skipPlayerValidation` holds it, which is how
    // the fragment came to carry it, and the structural rules report
    // it. The skip was therefore deleting a dangling reference instead
    // of reporting one (barwise-997).
    // Three endpoint shapes, because the guard is a disjunction: a
    // fixture dangling BOTH ends lets either half alone account for it.
    for (
      const [subtypeId, supertypeId, expectedRule] of [
        ["ot-nowhere", "ot-elsewhere", "structural/subtype-dangling-subtype"],
        ["ot-nowhere", "ot-emp", "structural/subtype-dangling-subtype"],
        ["ot-mgr", "ot-nowhere", "structural/subtype-dangling-supertype"],
      ] as const
    ) {
      const existing = base();
      const incoming = fragment();
      incoming.addSubtypeFact({ id: "sf-3", subtypeId, supertypeId }, lenient);

      const { deltas } = diffModels(existing, incoming);
      // Accept only what the fragment adds: accepting the removals would
      // empty the base model and confuse what is being asked.
      const accepted = new Set(
        deltas.map((d, i) => (d.kind === "added" ? i : -1)).filter((i) => i >= 0),
      );
      const result = mergeAndValidate(existing, incoming, deltas, accepted);

      expect(result.model?.subtypeFacts).toHaveLength(1);
      expect(result.isValid).toBe(false);
      expect(result.diagnostics.map((d) => d.ruleId)).toContain(expectedRule);
    }
  });
});

describe("an objectified fact type in a lenient fragment", () => {
  const oftDeltas = (a: OrmModel, b: OrmModel) =>
    diffModels(a, b).deltas.filter((d) => d.elementType === "objectified_fact_type");

  it("names both references as the existing model knows them", () => {
    const existing = base();
    const incoming = fragment();
    incoming.addObjectifiedFactType(
      { id: "oft-1", objectTypeId: "ot-mgr", factTypeId: "ft-works" },
      lenient,
    );

    const deltas = oftDeltas(existing, incoming);
    expect(deltas).toHaveLength(1);
    expect(deltas[0]!.kind).toBe("added");
    expect(deltas[0]!.objectType.name).toBe("Manager");
    expect(deltas[0]!.factType.name).toBe("EmployeeWorksInDepartment");
  });

  it("matches the existing one instead of reading as removed plus added", () => {
    const existing = base();
    existing.addObjectifiedFactType({
      id: "oft-1",
      objectTypeId: "ot-mgr",
      factTypeId: "ft-works",
    });

    const incoming = fragment();
    incoming.addObjectifiedFactType(
      { id: "oft-1", objectTypeId: "ot-mgr", factTypeId: "ft-works" },
      lenient,
    );

    expect(oftDeltas(existing, incoming).map((d) => d.kind)).toEqual(["unchanged"]);
  });

  it.each([
    ["neither reference is defined", "ot-nowhere", "ft-nowhere"],
    ["only its object type is undefined", "ot-nowhere", "ft-works"],
    ["only its fact type is undefined", "ot-mgr", "ft-nowhere"],
  ])("is reported when %s", (_which, objectTypeId, factTypeId) => {
    // Three cases because either half can be the dangling one, and a
    // check of one half alone would pass two of these.
    //
    // Inverted with the subtype-fact block above and for the same
    // reason: the merged model can hold this, and the
    // `structural/objectified-dangling-*` rules report it
    // (barwise-997).
    const existing = base();
    const incoming = fragment();
    incoming.addObjectifiedFactType({ id: "oft-2", objectTypeId, factTypeId }, lenient);

    expect(oftDeltas(existing, incoming).map((d) => d.kind)).toEqual(["added"]);
  });

  it("names both references from the incoming model when the EXISTING side is the fragment", () => {
    const existing = fragment();
    existing.addObjectifiedFactType(
      { id: "oft-1", objectTypeId: "ot-mgr", factTypeId: "ft-works" },
      lenient,
    );

    const incoming = base();
    incoming.addObjectifiedFactType({
      id: "oft-1",
      objectTypeId: "ot-mgr",
      factTypeId: "ft-works",
    });

    const deltas = oftDeltas(existing, incoming);
    expect(deltas.map((d) => d.kind)).toEqual(["unchanged"]);
    expect(deltas[0]!.objectType.name).toBe("Manager");
    expect(deltas[0]!.factType.name).toBe("EmployeeWorksInDepartment");
  });

  it("is reported on the existing side too, for the same reason", () => {
    // The mirror of the subtype-fact case: an existing model can hold
    // the dangling reference just as an incoming fragment can.
    const existing = base();
    existing.addObjectifiedFactType(
      { id: "oft-3", objectTypeId: "ot-nowhere", factTypeId: "ft-nowhere" },
      lenient,
    );

    expect(oftDeltas(existing, base()).map((d) => d.kind)).toEqual(["removed"]);
  });
});

describe("a fact type in a lenient fragment", () => {
  it("is unchanged when only the fragment's missing object types differ", () => {
    // The case barwise-957's note said could not happen. The fact type
    // matches by its own name either way; what broke was the comparison
    // of its role players, which resolves indirectly.
    const existing = base();
    const incoming = fragment();
    incoming.addFactType(
      {
        id: "ft-works",
        name: "EmployeeWorksInDepartment",
        roles: [
          { id: "r-worker", name: "worker", playerId: "ot-emp" },
          { id: "r-place", name: "workplace", playerId: "ot-dep" },
        ],
        readings: ["{0} works in {1}", "{1} employs {0}"],
      },
      lenient,
    );

    const ft = diffModels(existing, incoming).deltas.find((d) => d.elementType === "fact_type");
    expect(ft?.kind).toBe("unchanged");
    expect(ft?.changeDescriptions).toEqual([]);
  });
});

describe("a lenient fragment element the merge used to drop", () => {
  // barwise-997's core: `barwise merge` exited 0 with a population gone
  // and nothing said. Each of the three pair-keyed kinds now reaches the
  // merged model carrying its dangling reference, so the structural rule
  // that already exists for it reports at error severity and
  // mergeAndValidate returns isValid: false.
  //
  // Accepting only what the fragment ADDS throughout: accepting the
  // removals as well would empty the base model, which is the fragment's
  // own doing and not what these assert.
  const acceptAdded = (deltas: readonly { kind: string; }[]) =>
    new Set(deltas.map((d, i) => (d.kind === "added" ? i : -1)).filter((i) => i >= 0));

  it("carries a population whose fact type NEITHER model has, and reports it", () => {
    const existing = base();
    const incoming = fragment();
    incoming.addPopulation(
      {
        id: "pop-typo",
        factTypeId: "ft-typo",
        instances: [{ id: "i-1", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
      },
      lenient,
    );

    const { deltas } = diffModels(existing, incoming);
    const result = mergeAndValidate(existing, incoming, deltas, acceptAdded(deltas));

    expect(result.model?.populations).toHaveLength(1);
    expect(result.isValid).toBe(false);
    expect(result.diagnostics.map((d) => d.ruleId)).toContain("population/dangling-fact-type");
  });

  it.each([
    ["neither reference", "ot-nowhere", "ft-nowhere"],
    ["its object type alone", "ot-nowhere", "ft-works"],
    ["its fact type alone", "ot-mgr", "ft-nowhere"],
  ])(
    "carries an objectification dangling in %s, and reports it",
    (_which, objectTypeId, factTypeId) => {
      // Three cases because the guard is a disjunction and a fixture
      // that dangles BOTH halves lets either half alone account for it.
      const existing = base();
      const incoming = fragment();
      incoming.addObjectifiedFactType({ id: "oft-typo", objectTypeId, factTypeId }, lenient);

      const { deltas } = diffModels(existing, incoming);
      const result = mergeAndValidate(existing, incoming, deltas, acceptAdded(deltas));

      expect(result.model?.objectifiedFactTypes).toHaveLength(1);
      expect(result.isValid).toBe(false);
      expect(result.diagnostics.some((d) => d.ruleId.startsWith("structural/objectified-dangling")))
        .toBe(true);
    },
  );

  it("still drops, silently, what an ACCEPTED REMOVAL took", () => {
    // The other half of the split, and the reason the condition is
    // `isDangling*` rather than `!merged.getFactType(...)`. Removing the
    // fact type is the reviewer's decision; dropping the population that
    // depended on it is the merge doing what it was asked, and it must
    // stay quiet.
    const existing = base();
    existing.addPopulation({
      id: "pop-1",
      factTypeId: "ft-works",
      instances: [{ id: "i-1", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
    });

    // An incoming model that simply lacks the fact type, so the diff
    // offers its removal.
    const incoming = objectTypes();
    const { deltas } = diffModels(existing, incoming);

    // Accept the FACT TYPE's removal but REJECT the population's, so the
    // population is still chosen when the guard runs. Accepting both --
    // which an earlier version of this test did -- leaves `chosen`
    // undefined and the guard is never reached, so the fixture could not
    // see what it claimed to.
    const accepted = new Set(
      deltas
        .map((d, i) => (d.kind === "removed" && d.elementType !== "population" ? i : -1))
        .filter((i) => i >= 0),
    );
    const result = mergeAndValidate(existing, incoming, deltas, accepted);

    expect(result.model?.factTypes).toHaveLength(0);
    expect(result.model?.populations).toHaveLength(0);
    expect(result.isValid).toBe(true);
    expect(result.diagnostics).toEqual([]);
  });
});

describe("a renamed fact type in a lenient fragment", () => {
  it.each([
    ["the incoming side is the fragment", false],
    ["the existing side is the fragment", true],
  ])("is still offered as a synonym candidate when %s", (_which, existingIsFragment) => {
    // Synonym detection pairs a removed fact type with an added one
    // when their role players correspond POSITION BY POSITION, by name.
    // A fragment that renames a fact type without redefining its object
    // types resolved one side of every comparison to a UUID, so no two
    // names ever corresponded and the rename was reported as a plain
    // removal plus addition -- exactly the case the detector exists to
    // catch. Both directions, because the two sides resolve through
    // separate calls.
    const works = (m: OrmModel) => addWorks(m);
    const assigned = (m: OrmModel) => addWorks(m, "ft-assigned", "EmployeeIsAssignedTo");

    const existing = existingIsFragment ? works(fragment()) : works(objectTypes());
    const incoming = existingIsFragment ? assigned(objectTypes()) : assigned(fragment());

    const { synonymCandidates } = diffModels(existing, incoming);
    expect(synonymCandidates).toContainEqual(
      expect.objectContaining({
        elementType: "fact_type",
        removedName: "EmployeeWorksInDepartment",
        addedName: "EmployeeIsAssignedTo",
      }),
    );
  });
});

describe("a population in a lenient fragment", () => {
  it("names its fact type from the incoming model when the EXISTING side is the fragment", () => {
    const existing = fragment();
    existing.addPopulation(
      {
        id: "pop-gone",
        factTypeId: "ft-works",
        instances: [{ id: "i-1", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
      },
      lenient,
    );

    const pops = diffModels(existing, base()).deltas.filter((d) => d.elementType === "population");
    expect(pops.map((d) => d.kind)).toEqual(["removed"]);
    expect(pops[0]!.factType.name).toBe("EmployeeWorksInDepartment");
  });

  it("names its fact type as the existing model knows it when it is new", () => {
    const existing = base();
    const incoming = fragment();
    incoming.addPopulation(
      {
        id: "pop-new",
        factTypeId: "ft-works",
        instances: [{ id: "i-1", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
      },
      lenient,
    );

    const pops = diffModels(existing, incoming).deltas.filter(
      (d) => d.elementType === "population",
    );
    expect(pops.map((d) => d.kind)).toEqual(["added"]);
    expect(pops[0]!.factType.name).toBe("EmployeeWorksInDepartment");
  });

  it("groups with the existing population of the same fact type", () => {
    const existing = base();
    existing.addPopulation({
      id: "pop-1",
      factTypeId: "ft-works",
      instances: [{ id: "i-1", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
    });

    const incoming = fragment();
    incoming.addPopulation(
      {
        id: "pop-1",
        factTypeId: "ft-works",
        instances: [{ id: "i-1", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
      },
      lenient,
    );

    const pops = diffModels(existing, incoming).deltas.filter(
      (d) => d.elementType === "population",
    );
    expect(pops.map((d) => d.kind)).toEqual(["unchanged"]);
    expect(pops[0]!.factType.name).toBe("EmployeeWorksInDepartment");
  });

  it("resolves its roles from the other model when the EXISTING side is the lenient one", () => {
    // The mirror, and the one that matters most here: a tuple is keyed
    // by role POSITION, so reading the roles from the model that does
    // not have the fact type keys every tuple against an EMPTY role
    // list, which is a different key from the same tuple read against
    // the real roles. Two identical populations then compare unequal
    // and every merge reports the population modified with
    // `instances: 1 -> 1` -- the failure `instancesKey`'s own header
    // describes, reached by a different route.
    const existing = fragment();
    existing.addPopulation(
      {
        id: "pop-1",
        factTypeId: "ft-works",
        instances: [{ id: "i-1", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
      },
      lenient,
    );

    const incoming = base();
    incoming.addPopulation({
      id: "pop-1",
      factTypeId: "ft-works",
      instances: [{ id: "i-1", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
    });

    const pops = diffModels(existing, incoming).deltas.filter(
      (d) => d.elementType === "population",
    );
    expect(pops.map((d) => d.kind)).toEqual(["unchanged"]);
    expect(pops[0]!.factType.name).toBe("EmployeeWorksInDepartment");
  });

  it.each([
    ["the existing side is the fragment", true],
    ["the incoming side is the fragment", false],
  ])("still matches two populations of one fact type by content when %s", (_which, leftLenient) => {
    // Within a group, populations pair by tuple CONTENT first and only
    // then positionally, so that reordering two of them in the file
    // does not read as two modifications. That pass compares the two
    // sides' tuple keys, so a lenient side keying against an empty role
    // list defeats it silently: the reordering below then pairs
    // positionally and both populations read as modified.
    //
    // Both directions, because the two sides resolve through separate
    // calls and a fixture that is only ever lenient on one side leaves
    // the other call unexercised.
    const twoPops = (m: OrmModel, order: readonly string[]) => {
      for (const which of order) {
        const [emp, dep] = which === "first" ? ["E1", "D1"] : ["E2", "D2"];
        m.addPopulation(
          {
            id: `pop-${which}`,
            factTypeId: "ft-works",
            instances: [{ id: `i-${which}`, roleValues: { "r-worker": emp!, "r-place": dep! } }],
          },
          lenient,
        );
      }
      return m;
    };

    const existing = twoPops(leftLenient ? fragment() : base(), ["first", "second"]);
    const incoming = twoPops(leftLenient ? base() : fragment(), ["second", "first"]);

    const pops = diffModels(existing, incoming).deltas.filter(
      (d) => d.elementType === "population",
    );
    expect(pops.map((d) => d.kind)).toEqual(["unchanged", "unchanged"]);
  });
});
