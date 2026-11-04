/**
 * One answer to "which uniqueness identifies which entity type"
 * (orm-format-3, Open decision 8, WS4a and WS4b; barwise-971). A 2.0
 * `is_preferred` flag reads as naming the entity the roles opposite the
 * uniqueness identify, so the two conventions in use -- importers flag the
 * value's role, extraction flags the entity's -- give the same answer.
 * Each case builds a model with flags, places them as the 2.0 reader does
 * (`storePreferredFlags`), and reads the stored answer.
 */
import { describe, expect, it } from "vitest";
import type { InternalConstraint } from "../../src/model/Constraint.js";
import {
  isIdentified,
  placePreferredFlags,
  preferredIdentifiers,
  storePreferredFlags,
} from "../../src/model/identification.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/**
 * A uniqueness, flagged `is_preferred` as a 2.0 file would flag it. The
 * flag rides on the object, which the fact type stores as given, so each
 * model carries its own flags; the model type no longer has the field.
 */
type Flagged = InternalConstraint & { readonly isPreferred?: boolean; };
const uc = (id: string, roles: string[], preferred = false): Flagged => ({
  id,
  type: "internal_uniqueness",
  roleIds: roles,
  ...(preferred ? { isPreferred: true } : {}),
});
const isFlagged = (c: InternalConstraint) => (c as Flagged).isPreferred === true;
/** Place the flags, as the 2.0 reader does, and return the model. */
const placed = (model: OrmModel) => {
  storePreferredFlags(model, isFlagged);
  return model;
};

/** Customer has CustomerNumber, with `constraints` on it. */
function customer(constraints: InternalConstraint[]): OrmModel {
  const model = new OrmModel({ name: "Shop" });
  model.addObjectType({ id: "ot-c", name: "Customer", kind: "entity", referenceMode: "nr" });
  model.addObjectType({ id: "ot-nr", name: "CustomerNumber", kind: "value" });
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

const identifierOf = (model: OrmModel, entity: string) =>
  preferredIdentifiers(placed(model)).byEntity.get(entity)?.constraint.id;
const candidatesOf = (model: OrmModel, entity: string) =>
  placePreferredFlags(model, isFlagged).candidates.get(entity);

describe("preferredIdentifiers", () => {
  it("reads a flag on either role of an entity-value binary as the value role's uniqueness", () => {
    const both = [uc("u-c", ["r-c"]), uc("u-nr", ["r-nr"])];
    const onEntity = customer([{ ...both[0]!, isPreferred: true }, both[1]!]);
    const onValue = customer([both[0]!, { ...both[1]!, isPreferred: true }]);
    expect(identifierOf(onEntity, "ot-c")).toBe("u-nr");
    expect(identifierOf(onValue, "ot-c")).toBe("u-nr");
  });

  it("identifies nothing by a binary whose value role has no uniqueness", () => {
    // A number two customers could share identifies neither of them.
    expect(identifierOf(customer([uc("u-c", ["r-c"], true)]), "ot-c")).toBeUndefined();
  });

  it("gives the inverse, from the uniqueness to the entity", () => {
    const model = placed(customer([uc("u-c", ["r-c"], true), uc("u-nr", ["r-nr"])]));
    expect(preferredIdentifiers(model).byConstraint.get("u-nr")?.entityId).toBe("ot-c");
    expect(preferredIdentifiers(model).byConstraint.has("u-c")).toBe(false);
  });

  it("takes the flagged uniqueness when it is itself on the value's role", () => {
    // A second uniqueness on the same role, listed first, must not take
    // the place of the one the modeller flagged.
    const model = customer([
      { ...uc("u-other", ["r-nr"]), modality: "deontic" },
      uc("u-nr", ["r-nr"], true),
    ]);
    expect(identifierOf(model, "ot-c")).toBe("u-nr");
  });

  it("does not let a ring binary identify its player by itself", () => {
    const model = new OrmModel({ name: "Family" });
    model.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
    model.addFactType({
      id: "ft-parent",
      name: "Person is parent of Person",
      roles: [
        { id: "r-parent", name: "is parent of", playerId: "ot-p" },
        { id: "r-child", name: "is child of", playerId: "ot-p" },
      ],
      readings: ["{0} is parent of {1}"],
      constraints: [uc("u-parent", ["r-parent"], true)],
    });
    expect(identifierOf(model, "ot-p")).toBeUndefined();
  });

  it("identifies nothing by a flag that leaves two roles uncovered", () => {
    // "Person assigns Task to Person", flagged on Task: each Task has one
    // (assigner, assignee) pair, which identifies no Person.
    const model = new OrmModel({ name: "Work" });
    model.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "ot-t", name: "Task", kind: "entity", referenceMode: "nr" });
    model.addFactType({
      id: "ft-assign",
      name: "Person assigns Task to Person",
      roles: [
        { id: "r-by", name: "assigns", playerId: "ot-p" },
        { id: "r-t", name: "is assigned", playerId: "ot-t" },
        { id: "r-to", name: "to", playerId: "ot-p" },
      ],
      readings: ["{0} assigns {1} to {2}"],
      constraints: [uc("u-t", ["r-t"], true)],
    });
    expect(preferredIdentifiers(model).byEntity.size).toBe(0);
  });

  it("reads an entity-entity binary's flag as identifying the uncovered role's player", () => {
    const model = new OrmModel({ name: "Rooms" });
    model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "ot-b", name: "Building", kind: "entity", referenceMode: "code" });
    model.addFactType({
      id: "ft-in",
      name: "Room is in Building",
      roles: [
        { id: "r-room", name: "is in", playerId: "ot-room" },
        { id: "r-b", name: "houses", playerId: "ot-b" },
      ],
      readings: ["{0} is in {1}"],
      constraints: [uc("u-b", ["r-b"], true)],
    });
    expect(identifierOf(model, "ot-room")).toBe("u-b");
    expect(identifierOf(model, "ot-b")).toBeUndefined();
  });

  describe("an objectified fact type", () => {
    /** Customer signs Agreement for Organization, objectified as Signing. */
    function signing(flagged: string[], ownReference = false): OrmModel {
      const model = new OrmModel({ name: "Parties" });
      for (
        const [id, name] of [["ot-c", "Customer"], ["ot-o", "Organization"], [
          "ot-a",
          "Agreement",
        ], ["ot-s", "Signing"]] as const
      ) {
        model.addObjectType({ id, name, kind: "entity", referenceMode: "id" });
      }
      model.addFactType({
        id: "ft-sign",
        name: "Customer signs Agreement for Organization",
        roles: [
          { id: "r-c", name: "signs", playerId: "ot-c" },
          { id: "r-a", name: "is signed", playerId: "ot-a" },
          { id: "r-o", name: "for", playerId: "ot-o" },
        ],
        readings: ["{0} signs {1} for {2}"],
        constraints: [uc("u-sign", flagged, true)],
      });
      model.addObjectifiedFactType({ id: "oft", factTypeId: "ft-sign", objectTypeId: "ot-s" });
      if (ownReference) {
        model.addObjectType({ id: "ot-sid", name: "SigningId", kind: "value" });
        model.addFactType({
          id: "ft-sid",
          name: "Signing has SigningId",
          roles: [
            { id: "r-s", name: "has", playerId: "ot-s" },
            { id: "r-sid", name: "is of", playerId: "ot-sid" },
          ],
          readings: ["{0} has {1}"],
          constraints: [uc("u-s", ["r-s"], true), uc("u-sid", ["r-sid"])],
        });
      }
      return model;
    }

    it("is not identified by a flagged uniqueness over fewer than all but one role", () => {
      // One role of three cannot identify a ternary's objectification; the
      // flag falls to the rule for the roles it leaves uncovered, which are
      // played by two entity types, so it names nobody.
      expect(identifierOf(signing(["r-c"]), "ot-s")).toBeUndefined();
    });

    it("is identified by its flagged spanning uniqueness", () => {
      expect(identifierOf(signing(["r-c", "r-a", "r-o"]), "ot-s")).toBe("u-sign");
    });

    it("is identified by a flagged uniqueness over all but one role, as NORMA allows", () => {
      // Read literally, decision 8 would hand this flag to Organization,
      // the uncovered role's player.
      const model = signing(["r-c", "r-a"]);
      expect(identifierOf(model, "ot-s")).toBe("u-sign");
      expect(identifierOf(model, "ot-o")).toBeUndefined();
    });

    it("is identified by its objectification with no flag at all", () => {
      // The flag covers no role, so it names nobody; the objectification
      // alone identifies Signing.
      const unflagged = signing([]);
      expect(isIdentified(unflagged, "ot-s")).toBe(true);
      expect(isIdentified(unflagged, "ot-c")).toBe(false);
    });

    it("does not count its identifier toward a role player's flags", () => {
      // Customer plays a covered role of the flag that identifies Signing;
      // that flag is Signing's, so Customer has one candidate, not two.
      const model = signing(["r-c", "r-a"]);
      model.addObjectType({ id: "ot-cid", name: "CustomerId", kind: "value" });
      model.addFactType({
        id: "ft-cid",
        name: "Customer has CustomerId",
        roles: [
          { id: "r-cc", name: "has", playerId: "ot-c" },
          { id: "r-cid", name: "is of", playerId: "ot-cid" },
        ],
        readings: ["{0} has {1}"],
        constraints: [uc("u-cc", ["r-cc"], true), uc("u-cid", ["r-cid"])],
      });
      expect(candidatesOf(model, "ot-c")?.length).toBe(1);
      expect(identifierOf(model, "ot-c")).toBe("u-cid");
      expect(identifierOf(model, "ot-s")).toBe("u-sign");
    });

    it("keeps its own reference binary when both are flagged (Open decision 11)", () => {
      // The fact type comes first in model order; the binary still wins,
      // so the key the mapper gives Signing does not move.
      expect(identifierOf(signing(["r-c", "r-a", "r-o"], true), "ot-s")).toBe("u-sid");
    });
  });

  it("takes the first in model order between two binaries naming one entity", () => {
    const model = customer([uc("u-c", ["r-c"], true), uc("u-nr", ["r-nr"])]);
    model.addObjectType({ id: "ot-mail", name: "Email", kind: "value" });
    model.addFactType({
      id: "ft-mail",
      name: "Customer has Email",
      roles: [
        { id: "r-c2", name: "has", playerId: "ot-c" },
        { id: "r-mail", name: "is of", playerId: "ot-mail" },
      ],
      readings: ["{0} has {1}"],
      constraints: [uc("u-c2", ["r-c2"], true), uc("u-mail", ["r-mail"])],
    });
    expect(identifierOf(model, "ot-c")).toBe("u-nr");
  });

  it("keeps both flags naming one entity as candidates, and stores the first", () => {
    // A 2.0 file can name two identifiers for one entity; the stored
    // reference holds one, so the placement keeps both for a caller that
    // reports the second (the llm parser does).
    const model = customer([uc("u-c", ["r-c"], true), uc("u-nr", ["r-nr"])]);
    model.addObjectType({ id: "ot-mail", name: "Email", kind: "value" });
    model.addFactType({
      id: "ft-mail",
      name: "Customer has Email",
      roles: [
        { id: "r-c2", name: "has", playerId: "ot-c" },
        { id: "r-mail", name: "is of", playerId: "ot-mail" },
      ],
      readings: ["{0} has {1}"],
      constraints: [uc("u-c2", ["r-c2"]), uc("u-mail", ["r-mail"], true)],
    });
    expect(candidatesOf(model, "ot-c")?.map((at) => at.constraint.id)).toEqual(["u-nr", "u-mail"]);
    expect(identifierOf(model, "ot-c")).toBe("u-nr");
  });

  it("counts one identifier when both roles of its binary are flagged", () => {
    // The importers flag the value's role and extraction the entity's, so
    // a merged model can carry both; they name one uniqueness.
    const model = customer([uc("u-c", ["r-c"], true), uc("u-nr", ["r-nr"], true)]);
    expect(candidatesOf(model, "ot-c")).toHaveLength(1);
    expect(identifierOf(model, "ot-c")).toBe("u-nr");
  });
});
