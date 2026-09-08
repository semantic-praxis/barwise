/**
 * Populations are diffed and merged from deltas, keyed by
 * `(fact type, sample)` plus position within that group.
 *
 * The identity is the decision worth testing. Nothing in the metamodel
 * limits a fact type to one population, so something has to separate
 * two of them, and the candidates were the fact type alone, the fact
 * type with the description, and the fact type with the sample flag.
 * Description lost because it is prose -- a non-key attribute whose
 * edit would turn a modification into a delete plus an insert, so
 * rewording one would report the population removed and a different one
 * added, its instances appearing to vanish and reappear.
 *
 * `sample` won because it is stable under that edit and separates the
 * one distinction a fact type plausibly needs: the complete extension a
 * rule is checked against, and the illustrative tuples that are
 * positive evidence only.
 *
 * No model in the repository has a fact type carrying both -- verified
 * across every tracked `.orm.yaml` -- so the key's discriminating half
 * had nothing to prove itself against until this fixture (barwise-955).
 */

import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/**
 * One fact type carrying a significant AND a sample population.
 *
 * Ids are fixed so the two models are id-stable, which is what an
 * `.orm.yaml` edited on disk looks like and the condition under which
 * merge defects actually surface.
 */
function bothKinds(significantValue: string, sampleValue: string, description?: string) {
  const m = new OrmModel({ name: "M" });
  m.addObjectType({ id: "ot-emp", name: "Employee", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: "ot-dep", name: "Department", kind: "entity", referenceMode: "code" });
  m.addFactType({
    id: "ft-works",
    name: "EmployeeWorksInDepartment",
    roles: [
      { id: "r-worker", name: "worker", playerId: "ot-emp" },
      { id: "r-place", name: "workplace", playerId: "ot-dep" },
    ],
    readings: ["{0} works in {1}", "{1} employs {0}"],
  });
  m.addPopulation({
    id: "pop-sig",
    factTypeId: "ft-works",
    description: description ?? "Placements we have confirmed.",
    instances: [{ id: "i-sig", roleValues: { "r-worker": significantValue, "r-place": "D1" } }],
  });
  m.addPopulation({
    id: "pop-sample",
    factTypeId: "ft-works",
    sample: true,
    description: "An illustrative placement from the interview.",
    instances: [{ id: "i-sam", roleValues: { "r-worker": sampleValue, "r-place": "D2" } }],
  });
  return m;
}

/** Every index, i.e. accept the lot. */
const all = (n: number) => new Set(Array.from({ length: n }, (_, i) => i));

describe("the identity key separates a significant population from a sample", () => {
  it("matches each to its own kind rather than collapsing them", () => {
    // Both populations changed. Keying on the fact type alone would
    // collide them and report one modification where there are two.
    const { deltas } = diffModels(bothKinds("E1", "E2"), bothKinds("E9", "E8"));
    const pops = deltas.filter((d) => d.elementType === "population");

    expect(pops).toHaveLength(2);
    expect(pops.every((d) => d.kind === "modified")).toBe(true);
    expect(pops.filter((d) => d.sample)).toHaveLength(1);
    expect(pops.filter((d) => !d.sample)).toHaveLength(1);
  });

  it("pairs by kind even when the two models declare them in opposite order", () => {
    // The case that proves the FLAG is doing the work. The key also
    // carries an ordinal within its group -- needed because nothing
    // stops a fact type having two significant populations -- and when
    // both models declare significant-then-sample, that ordinal pairs
    // them correctly on its own. Removing `sample` from the key then
    // changes nothing, so a test using same-order models cannot tell
    // the flag is there. Declaring them in opposite order separates the
    // two mechanisms: with the flag, significant matches significant;
    // without it, the ordinal pairs significant with sample and reports
    // two modifications that swapped their tuples.
    const sampleFirst = new OrmModel({ name: "M" });
    sampleFirst.addObjectType({
      id: "ot-emp",
      name: "Employee",
      kind: "entity",
      referenceMode: "nr",
    });
    sampleFirst.addObjectType({
      id: "ot-dep",
      name: "Department",
      kind: "entity",
      referenceMode: "code",
    });
    sampleFirst.addFactType({
      id: "ft-works",
      name: "EmployeeWorksInDepartment",
      roles: [
        { id: "r-worker", name: "worker", playerId: "ot-emp" },
        { id: "r-place", name: "workplace", playerId: "ot-dep" },
      ],
      readings: ["{0} works in {1}", "{1} employs {0}"],
    });
    // Sample declared FIRST, significant second -- the reverse of
    // `bothKinds`.
    sampleFirst.addPopulation({
      id: "pop-sample",
      factTypeId: "ft-works",
      sample: true,
      description: "An illustrative placement from the interview.",
      instances: [{ id: "i-sam", roleValues: { "r-worker": "E2", "r-place": "D2" } }],
    });
    sampleFirst.addPopulation({
      id: "pop-sig",
      factTypeId: "ft-works",
      description: "Placements we have confirmed.",
      instances: [{ id: "i-sig", roleValues: { "r-worker": "E1", "r-place": "D1" } }],
    });

    // Same content as `bothKinds("E1", "E2")`, only reordered, so a key
    // that reads the flag reports nothing changed at all.
    const pops = diffModels(bothKinds("E1", "E2"), sampleFirst)
      .deltas.filter((d) => d.elementType === "population");
    expect(pops).toHaveLength(2);
    expect(pops.every((d) => d.kind === "unchanged")).toBe(true);
  });

  it("reads a flipped flag as remove-plus-add, not as a modification", () => {
    // Changing whether a population is a sample is a change of KIND,
    // not of content: it changes whether those tuples create obligations
    // at all. Remove-plus-add is the honest report.
    const significantOnly = new OrmModel({ name: "M" });
    significantOnly.addObjectType({
      id: "ot-emp",
      name: "Employee",
      kind: "entity",
      referenceMode: "nr",
    });
    significantOnly.addFactType({
      id: "ft-solo",
      name: "EmployeeExists",
      roles: [{ id: "r-e", name: "e", playerId: "ot-emp" }],
      readings: ["{0} exists"],
    });
    significantOnly.addPopulation({
      id: "p1",
      factTypeId: "ft-solo",
      instances: [{ id: "i1", roleValues: { "r-e": "E1" } }],
    });

    const sampleOnly = new OrmModel({ name: "M" });
    sampleOnly.addObjectType({
      id: "ot-emp",
      name: "Employee",
      kind: "entity",
      referenceMode: "nr",
    });
    sampleOnly.addFactType({
      id: "ft-solo",
      name: "EmployeeExists",
      roles: [{ id: "r-e", name: "e", playerId: "ot-emp" }],
      readings: ["{0} exists"],
    });
    sampleOnly.addPopulation({
      id: "p1",
      factTypeId: "ft-solo",
      sample: true,
      instances: [{ id: "i1", roleValues: { "r-e": "E1" } }],
    });

    const kinds = diffModels(significantOnly, sampleOnly)
      .deltas.filter((d) => d.elementType === "population")
      .map((d) => d.kind)
      .sort();
    expect(kinds).toEqual(["added", "removed"]);
  });

  it("does not report a modification when only the description was reworded", () => {
    // The reason description is not in the key. Under a description key
    // this would read as removed-plus-added and the instances would
    // appear to vanish and reappear.
    const { deltas } = diffModels(
      bothKinds("E1", "E2", "Placements we have confirmed."),
      bothKinds("E1", "E2", "Confirmed placements."),
    );
    const pops = deltas.filter((d) => d.elementType === "population");

    expect(pops.map((d) => d.kind).sort()).toEqual(["modified", "unchanged"]);
    const modified = pops.find((d) => d.kind === "modified")!;
    expect(modified.changeDescriptions).toEqual([
      `population description: "Placements we have confirmed." -> "Confirmed placements."`,
    ]);
    expect(modified.breakingLevel).toBe("safe");
  });
});

describe("a population merges from its delta rather than being carried", () => {
  it("takes the incoming tuples when the delta is accepted", () => {
    const existing = bothKinds("E1", "E2");
    const incoming = bothKinds("E9", "E8");
    const { deltas } = diffModels(existing, incoming);

    const merged = mergeModels(existing, incoming, deltas, all(deltas.length));
    const significant = merged.populations.find((p) => !p.sample)!;
    expect(significant.instances[0]!.roleValues["r-worker"]).toBe("E9");
  });

  it("keeps the existing tuples when the delta is rejected", () => {
    const existing = bothKinds("E1", "E2");
    const incoming = bothKinds("E9", "E8");
    const { deltas } = diffModels(existing, incoming);

    const merged = mergeModels(existing, incoming, deltas, new Set());
    const significant = merged.populations.find((p) => !p.sample)!;
    expect(significant.instances[0]!.roleValues["r-worker"]).toBe("E1");
  });

  it("keeps both kinds through a merge that changes neither", () => {
    const model = bothKinds("E1", "E2");
    const { deltas } = diffModels(model, bothKinds("E1", "E2"));

    const merged = mergeModels(model, bothKinds("E1", "E2"), deltas, new Set());
    expect(merged.populations).toHaveLength(2);
    expect(merged.populations.filter((p) => p.sample)).toHaveLength(1);
  });
});
