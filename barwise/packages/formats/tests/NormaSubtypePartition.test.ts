/**
 * A constraint over subtypes through NORMA (orm-format-3 WS4b). NORMA
 * states a partition as an exclusion and a disjunctive mandatory over the
 * supertype meta-roles; the model states it as a constraint over the
 * subtype facts. Until commit 3 maps them one to one, both directions go
 * through the 2.0 flags' conversion, so a partition must survive the trip.
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
