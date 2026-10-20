/**
 * `counterexamplesTouching` (orm-format-3 WS3a-ii): a view of one fact type
 * gets the counterexamples of every constraint that applies to it, so a
 * constraint across fact types is probed under each fact type it touches,
 * matching what the verbalization of that fact type now says, rather than
 * only under the fact type a 2.0 file nests it in.
 */
import { describe, expect, it } from "vitest";
import {
  counterexamplesTouching,
  generateCounterexamples,
} from "../../src/counterexample/CounterexampleGenerator.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

function drivesRidesWalks() {
  const model = new ModelBuilder()
    .withEntityType("Person")
    .withEntityType("Car")
    .withEntityType("Bus")
    .withEntityType("Park")
    .withBinaryFactType("Person drives Car", {
      role1: { player: "Person", name: "drives" },
      role2: { player: "Car", name: "is driven by" },
    })
    .withBinaryFactType("Person rides Bus", {
      role1: { player: "Person", name: "rides" },
      role2: { player: "Bus", name: "is ridden by" },
    })
    .withBinaryFactType("Person walks in Park", {
      role1: { player: "Person", name: "walks in" },
      role2: { player: "Park", name: "is walked in by" },
    })
    .build();
  const drives = model.getFactTypeByName("Person drives Car")!;
  // Nested under "drives", touching "rides" too, and not "walks".
  drives.addConstraint({
    id: "c-excl",
    type: "exclusion",
    roleIds: ["Person drives Car::role1", "Person rides Bus::role1"],
  });
  return model;
}

describe("counterexamplesTouching", () => {
  it("gives a constraint across fact types to every fact type it touches", () => {
    const model = drivesRidesWalks();
    const all = generateCounterexamples(model);
    const ids = (name: string) =>
      counterexamplesTouching(model.getFactTypeByName(name)!.id, all).map((c) => c.constraintId);

    expect(ids("Person drives Car")).toContain("c-excl");
    expect(ids("Person rides Bus")).toContain("c-excl");
    expect(ids("Person walks in Park")).not.toContain("c-excl");
  });

  it("keeps a fact type's own internal counterexamples", () => {
    const model = drivesRidesWalks();
    const walks = model.getFactTypeByName("Person walks in Park")!;
    walks.addConstraint({
      id: "c-walks-uc",
      type: "internal_uniqueness",
      roleIds: [walks.roles[0]!.id],
    });
    const all = generateCounterexamples(model);
    expect(counterexamplesTouching(walks.id, all).map((c) => c.constraintId)).toEqual([
      "c-walks-uc",
    ]);
  });
});
