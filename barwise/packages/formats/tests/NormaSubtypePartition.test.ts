/**
 * A constraint over subtypes through NORMA (orm-format-3 WS4b). NORMA
 * states a partition as an exclusion and a disjunctive mandatory over the
 * supertype meta-roles; the model states it as a constraint over the
 * subtype facts. Each maps to the other one to one, with its modality, so a
 * partition survives the trip as the constraint it was, not as flags on
 * each subtype that a second partition of the same supertype would widen.
 */
import { type ExternalConstraint, OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { importNormaXml } from "../src/norma/NormaXmlImporter.js";
import { serializeNormaDocument } from "../src/norma/NormaXmlSerializer.js";
import { writeOrmToNorma } from "../src/norma/NormaXmlWriter.js";

function people(type: ExternalConstraint["type"] & ("exclusion" | "exclusive_or")): OrmModel {
  const model = new OrmModel({ name: "People" });
  const person = model.addObjectType({ name: "Person", kind: "entity", referenceMode: "id" });
  const ids = ["Male", "Female"].map((name) => {
    const ot = model.addObjectType({ name, kind: "entity", referenceMode: "id" });
    return model.addSubtypeFact({ subtypeId: ot.id, supertypeId: person.id }).id;
  });
  model.addConstraint({ type, subtypeFactIds: ids });
  return model;
}

/** Each constraint over subtypes, by kind and the subtypes it names. */
function partitions(model: OrmModel) {
  return model.constraints.flatMap((c) =>
    c.subtypeFactIds
      ? [{
        type: c.type,
        subtypes: c.subtypeFactIds.map((id) => {
          const sf = model.getSubtypeFact(id);
          return sf && model.getObjectType(sf.subtypeId)?.name;
        }),
      }]
      : []
  );
}

const roundTrip = (model: OrmModel) =>
  importNormaXml(serializeNormaDocument(writeOrmToNorma(model)));

describe("a constraint over subtypes through NORMA", () => {
  it.each(["exclusion", "exclusive_or"] as const)("keeps an %s", (type) => {
    const model = people(type);
    expect(partitions(roundTrip(model))).toEqual([{ type, subtypes: ["Male", "Female"] }]);
  });

  it("keeps two exclusions over one supertype apart, and a deontic modality", () => {
    // Read back as flags on each subtype, the two became one exclusion over
    // all four, which says a Male is never a Child.
    const model = new OrmModel({ name: "People" });
    const person = model.addObjectType({ name: "Person", kind: "entity", referenceMode: "id" });
    const ids = ["Male", "Female", "Adult", "Child"].map((name) => {
      const ot = model.addObjectType({ name, kind: "entity", referenceMode: "id" });
      return model.addSubtypeFact({ subtypeId: ot.id, supertypeId: person.id }).id;
    });
    model.addConstraint({ type: "exclusion", subtypeFactIds: [ids[0]!, ids[1]!] });
    model.addConstraint({
      type: "exclusion",
      modality: "deontic",
      subtypeFactIds: [ids[2]!, ids[3]!],
    });
    const back = roundTrip(model);
    expect(partitions(back)).toEqual([
      { type: "exclusion", subtypes: ["Male", "Female"] },
      { type: "exclusion", subtypes: ["Adult", "Child"] },
    ]);
    expect(back.constraints.map((c) => c.modality ?? "alethic")).toEqual(["alethic", "deontic"]);
  });

  it("pairs an exclusion and a mandatory into an exclusive-or only over the same subtypes", () => {
    const model = new OrmModel({ name: "People" });
    const person = model.addObjectType({ name: "Person", kind: "entity", referenceMode: "id" });
    const ids = ["Male", "Female", "Other"].map((name) => {
      const ot = model.addObjectType({ name, kind: "entity", referenceMode: "id" });
      return model.addSubtypeFact({ subtypeId: ot.id, supertypeId: person.id }).id;
    });
    model.addConstraint({ type: "exclusion", subtypeFactIds: [ids[0]!, ids[1]!] });
    model.addConstraint({ type: "disjunctive_mandatory", subtypeFactIds: ids });
    expect(partitions(roundTrip(model))).toEqual([
      { type: "exclusion", subtypes: ["Male", "Female"] },
      { type: "disjunctive_mandatory", subtypes: ["Male", "Female", "Other"] },
    ]);
  });

  it("exports one with no subtype facts as nothing, rather than failing", () => {
    const model = people("exclusion");
    model.addConstraint({ type: "exclusion", subtypeFactIds: [] });
    expect(() => writeOrmToNorma(model)).not.toThrow();
  });

  it("is written over the meta-roles of the subtypes it names, and no others", () => {
    // Employee is a third subtype the exclusion does not name; writing it
    // over every subtype of Person would invent "no Employee is a Male".
    const model = people("exclusion");
    const person = model.getObjectTypeByName("Person")!;
    const employee = model.addObjectType({ name: "Employee", kind: "entity", referenceMode: "id" });
    model.addSubtypeFact({ subtypeId: employee.id, supertypeId: person.id });
    expect(partitions(roundTrip(model))).toEqual([
      { type: "exclusion", subtypes: ["Male", "Female"] },
    ]);
  });

  it("is written over the supertype meta-roles, not as a constraint over no roles", () => {
    const doc = writeOrmToNorma(people("exclusion"));
    const exclusions = doc.constraints.filter((c) => c.type === "exclusion");
    expect(exclusions).toHaveLength(1);
    const metaRoles = new Set(doc.subtypeFacts.map((sf) => sf.supertypeRoleId));
    const roles = exclusions[0]!.type === "exclusion" ? exclusions[0]!.roleSequences.flat() : [];
    expect(roles.length).toBe(2);
    expect(roles.every((r) => metaRoles.has(r))).toBe(true);
  });
});
