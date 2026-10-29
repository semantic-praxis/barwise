/**
 * A model with one constraint the relational schema does not carry (an
 * irreflexive ring, when asked for) and one it does (a mandatory the
 * mapping enforces as NOT NULL), for the adapters that report what they
 * drop (schema-export-constraint-specs.spec.md).
 */
import type { OrmModel } from "@barwise/core";
import { ModelBuilder } from "./ModelBuilder.js";
import { roleId } from "./ModelBuilder.js";

export const MENTOR_RING_PSEUDOCODE = "for all x: not Person mentors Person(x, x)";

export function mentorsModel(withRing: boolean): OrmModel {
  const model = new ModelBuilder("Test")
    .withEntityType("Person", { referenceMode: "person_id" })
    .withValueType("Name", { dataType: { name: "text" } })
    .withBinaryFactType("Person has Name", {
      role1: { player: "Person", name: "has" },
      role2: { player: "Name", name: "is of" },
      uniqueness: "role1",
      mandatory: "role1",
    })
    .withBinaryFactType("Person mentors Person", {
      role1: { player: "Person", name: "mentors" },
      role2: { player: "Person", name: "is mentored by" },
      uniqueness: "role2",
    })
    .build();
  if (withRing) {
    model.getFactTypeByName("Person mentors Person")!.addConstraint({
      type: "ring",
      roleId1: roleId("Person mentors Person", 1),
      roleId2: roleId("Person mentors Person", 2),
      ringType: "irreflexive",
    });
  }
  return model;
}
