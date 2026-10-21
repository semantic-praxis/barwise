/**
 * NORMA export names one preferred identifier per entity, and marks that
 * same uniqueness `IsPreferred` (orm-format-3 WS4a). An extracted model
 * flags the entity's role ("each Customer has at most one number"); the
 * reference scheme NORMA means is the uniqueness on the value's role, and
 * the export used to write no `PreferredIdentifier` for such a model while
 * marking the entity-role uniqueness preferred.
 */
import { type InternalConstraint, OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { writeOrmToNorma } from "../src/norma/NormaXmlWriter.js";

function customer(flagOn: "entity" | "value"): OrmModel {
  const model = new OrmModel({ name: "Shop" });
  model.addObjectType({ id: "ot-c", name: "Customer", kind: "entity", referenceMode: "nr" });
  model.addObjectType({ id: "ot-nr", name: "CustomerNumber", kind: "value" });
  const constraints: InternalConstraint[] = [
    {
      id: "u-c",
      type: "internal_uniqueness",
      roleIds: ["r-c"],
      ...(flagOn === "entity" ? { isPreferred: true } : {}),
    },
    {
      id: "u-nr",
      type: "internal_uniqueness",
      roleIds: ["r-nr"],
      ...(flagOn === "value" ? { isPreferred: true } : {}),
    },
  ];
  model.addFactType({
    id: "ft-nr",
    name: "Customer has CustomerNumber",
    roles: [
      { id: "r-c", name: "has", playerId: "ot-c" },
      { id: "r-nr", name: "is of", playerId: "ot-nr" },
    ],
    readings: ["{0} has {1}"],
    constraints,
  });
  return model;
}

describe("NORMA export of a preferred identifier", () => {
  for (const flagOn of ["entity", "value"] as const) {
    it(`links the value role's uniqueness and marks only it, with the flag on the ${flagOn}'s role`, () => {
      const doc = writeOrmToNorma(customer(flagOn));
      const entity = doc.entityTypes.find((e) => e.name === "Customer")!;
      const preferred = doc.constraints.filter((c) => c.type === "uniqueness" && c.isPreferred);
      expect(preferred.map((c) => c.id)).toEqual([entity.preferredIdentifier]);
      expect(preferred[0]!.type === "uniqueness" && preferred[0]!.roleRefs).toEqual(["_r-nr"]);
    });
  }
});
