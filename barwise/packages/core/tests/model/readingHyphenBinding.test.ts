/**
 * ORM hyphen binding in readings (reading-hyphen-binding.spec.md): a word
 * ending in a hyphen before a placeholder, and every word after it up to
 * the placeholder, qualify that role's player. "{0} has sale- {1}" reads
 * "Listing has sale Currency", and with a quantifier "Each Listing has at
 * most one sale Currency" -- not "Each Listing has sale- at most one
 * Currency", which every reader printed before.
 */
import { describe, expect, it } from "vitest";
import type { Constraint, InternalConstraint } from "../../src/model/Constraint.js";
import type { FactType } from "../../src/model/FactType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { expandReading, splitReading } from "../../src/model/ReadingOrder.js";
import { runQuery } from "../../src/query/index.js";
import { ConstraintVerbalizer } from "../../src/verbalization/ConstraintVerbalizer.js";
import { FactTypeVerbalizer } from "../../src/verbalization/FactTypeVerbalizer.js";

const leads = (template: string) =>
  splitReading(template).parts.flatMap((p) => p.kind === "role" ? [[p.index, p.lead]] : []);

describe("splitReading", () => {
  it("binds the hyphenated word to the player that follows", () => {
    const { parts, unbound } = splitReading("{0} has sale- {1}");
    expect(parts).toEqual([
      { kind: "role", index: 0, lead: "" },
      { kind: "text", text: " has " },
      { kind: "role", index: 1, lead: "sale" },
    ]);
    expect(unbound).toBe(false);
  });

  it("binds every word from the hyphen to the placeholder, whitespace collapsed", () => {
    expect(leads("{0} has average-  departure {1}")).toEqual([[0, ""], [1, "average departure"]]);
    expect(leads("{0} has big- red- {1}")).toEqual([[0, ""], [1, "big red"]]);
  });

  it("leaves a hyphen flush against the placeholder as a prefix compound", () => {
    // "non-Smoker", not "non Smoker": binding needs whitespace after the hyphen.
    expect(leads("{0} is a non-{1}")).toEqual([[0, ""], [1, ""]]);
    expect(splitReading("{0} is a non-{1}").unbound).toBe(false);
    expect(expandReading("{0} is a non-{1}", ["Person", "Smoker"])).toBe("Person is a non-Smoker");
  });

  it("binds a word in any script", () => {
    expect(leads("{0} has café- {1}")).toEqual([[0, ""], [1, "café"]]);
  });

  it("leaves a hyphen inside a word, or a dash standing alone, as text", () => {
    for (const template of ["{0} is co-owner of {1}", "{0} reports to - {1}"]) {
      expect(leads(template)).toEqual([[0, ""], [1, ""]]);
      expect(splitReading(template).unbound).toBe(false);
    }
  });

  it("reports a hyphen that binds nothing", () => {
    expect(splitReading("{0} smiles- ").unbound).toBe(true);
    expect(splitReading("{0} smiles-").unbound).toBe(true);
    // The trailing form, which barwise does not bind, also inside a lead.
    expect(splitReading("{0} -word {1}").unbound).toBe(true);
    expect(splitReading("{0} has sale- -x {1}").unbound).toBe(true);
  });

  it("reads a minus sign as text, not as the trailing form", () => {
    expect(splitReading("{0} has balance -5 below {1}").unbound).toBe(false);
  });

  it("binds each placeholder's own stretch only", () => {
    expect(leads("{0} has sold- {1} at {2}")).toEqual([[0, ""], [1, "sold"], [2, ""]]);
  });
});

describe("expandReading", () => {
  it("prints the lead before its player and drops the hyphen", () => {
    expect(expandReading("{0} has sale- {1}", ["Listing", "Currency"])).toBe(
      "Listing has sale Currency",
    );
    expect(expandReading("{0} has sold- {1} at {2}", ["Item", "Price", "Time"])).toBe(
      "Item has sold Price at Time",
    );
  });

  it("leaves a reading without the notation as it was", () => {
    expect(expandReading("{0} is co-owner of {1}", ["Person", "Company"])).toBe(
      "Person is co-owner of Company",
    );
  });
});

describe("constraint sentences place a lead after the quantifier", () => {
  const verbalizer = new ConstraintVerbalizer();

  /** Listing has sale- Currency, with the given constraints. */
  function listing(readings: readonly string[], constraints: InternalConstraint[]) {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "l", name: "Listing", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "c", name: "Currency", kind: "entity", referenceMode: "code" });
    const ft = model.addFactType({
      id: "ft",
      name: "Listing has sale Currency",
      roles: [{ id: "rl", name: "has", playerId: "l" }, { id: "rc", name: "is of", playerId: "c" }],
      readings: [...readings],
      constraints,
    });
    return { model, ft };
  }
  const texts = (model: OrmModel, ft: FactType) =>
    verbalizer.verbalizeAll(ft.id, model).map((v) => v.text);

  it("uniqueness and mandatory", () => {
    const { model, ft } = listing(["{0} has sale- {1}"], [
      { type: "internal_uniqueness", roleIds: ["rl"] },
      { type: "mandatory", roleId: "rl" },
    ]);
    expect(texts(model, ft)).toEqual([
      "Each Listing has at most one sale Currency.",
      "Each Listing has at least one sale Currency.",
    ]);
  });

  it("frequency", () => {
    const { model, ft } = listing(["{0} has sale- {1}"], [
      { type: "frequency", roleIds: ["rl"], min: 2, max: 2 },
    ]);
    expect(texts(model, ft)).toEqual(["Each Listing has exactly 2 sale Currency."]);
  });

  it("keeps every lead on its own noun when no reading has the needed order", () => {
    // Only "{1} is sale- price of {0}" exists, and the uniqueness is on
    // role 0: the sentence is written from that reading as given
    // (binary-reverse-reading-verbalization.spec.md), and "sale price of"
    // stays bound to Listing, in the head and after "that", by the same
    // rule as every other lead.
    const { model, ft } = listing(["{1} is sale- price of {0}"], [
      { type: "internal_uniqueness", roleIds: ["rl"] },
    ]);
    expect(texts(model, ft)).toEqual([
      "For each sale price of Listing, at most one Currency is that sale price of Listing.",
    ]);
  });

  it("rings place the lead by role slot", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "i", name: "Item", kind: "entity", referenceMode: "id" });
    const ring = (ringType: "irreflexive" | "asymmetric") => {
      const ft = model.addFactType({
        name: `Item has child Item (${ringType})`,
        roles: [{ name: "has", playerId: "i" }, { name: "is child of", playerId: "i" }],
        readings: ["{0} has child- {1}"],
      });
      ft.addConstraint({
        type: "ring",
        roleId1: ft.roles[0]!.id,
        roleId2: ft.roles[1]!.id,
        ringType,
      });
      return texts(model, ft);
    };
    expect(ring("irreflexive")).toEqual(["No Item has that same child Item."]);
    expect(ring("asymmetric")[0]).toContain(
      "If Item1 has child Item2 then Item2 does not has child Item1",
    );
  });

  it("an exclusion arm puts 'some' before the lead, and omits a lead on its own role", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "p", name: "Person", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "c", name: "Car", kind: "entity", referenceMode: "vin" });
    model.addObjectType({ id: "b", name: "Bus", kind: "entity", referenceMode: "nr" });
    model.addObjectType({ id: "t", name: "Train", kind: "entity", referenceMode: "nr" });
    const drives = model.addFactType({
      name: "Person drives own Car",
      roles: [{ id: "rd", name: "drives", playerId: "p" }, { name: "is driven by", playerId: "c" }],
      readings: ["{0} drives own- {1}"],
    });
    model.addFactType({
      name: "Person rides Bus",
      roles: [{ id: "rr", name: "rides", playerId: "p" }, { name: "is ridden by", playerId: "b" }],
      readings: ["regular- {0} rides {1}"],
    });
    model.addFactType({
      name: "Person boards Train",
      roles: [{ id: "rt", name: "boards", playerId: "p" }, {
        name: "is boarded by",
        playerId: "t",
      }],
      readings: ["the {0} boards onto {1}"],
    });
    const exclusion = { type: "exclusion", roleIds: ["rd", "rr", "rt"] } as Constraint;
    // "the {0} ..." is not chosen: the arm falls back to the role name
    // ("boards some Train"), not the reading ("boards onto some Train").
    expect(verbalizer.verbalize(exclusion, drives, model).text).toBe(
      "No Person both drives some own Car, rides some Bus and boards some Train.",
    );
  });

  it("a unary cardinality names neither the hyphen nor an empty role", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "i", name: "Item", kind: "entity", referenceMode: "id" });
    const ft = model.addFactType({
      name: "Item is active",
      roles: [{ id: "ra", name: "is active", playerId: "i" }],
      readings: ["active- {0}"],
      constraints: [{ type: "cardinality", roleId: "ra", min: 0, max: 3 }],
    });
    expect(texts(model, ft)).toEqual([
      "The 'Item is active' role is played by at most 3 active Item instances.",
    ]);
  });
});

describe("query output", () => {
  it("prints a hyphen-bound reading with its lead before the player", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "l", name: "Listing", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "c", name: "Currency", kind: "entity", referenceMode: "code" });
    model.addFactType({
      name: "Listing has sale Currency",
      roles: [{ name: "has", playerId: "l" }, { name: "is of", playerId: "c" }],
      readings: ["{0} has sale- {1}"],
    });
    const result = runQuery(model, 'fact-type "Listing has sale Currency"');
    expect(result.kind === "fact-type-detail" && result.detail.readings).toEqual([
      "Listing has sale Currency",
    ]);
  });
});

describe("fact type verbalization", () => {
  it("keeps the bound word, before its player, as text", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ id: "l", name: "Listing", kind: "entity", referenceMode: "id" });
    model.addObjectType({ id: "c", name: "Currency", kind: "entity", referenceMode: "code" });
    const ft = model.addFactType({
      name: "Listing has sale Currency",
      roles: [{ name: "has", playerId: "l" }, { name: "is of", playerId: "c" }],
      readings: ["{0} has sale- {1}"],
    });
    const [v] = new FactTypeVerbalizer().verbalizeAll(ft, model);
    expect(v?.text).toBe("Listing has sale Currency");
    // The lead is text, not part of the player reference.
    expect(v?.segments.map((s) => s.text)).toEqual(["Listing", " has ", "sale ", "Currency"]);
  });
});
