/**
 * A candidate that expresses the reference's rule in a WIDER form has
 * expressed it (barwise-911).
 *
 * `CANDIDATE_GUARDS` pairs two constraint types with `internal_uniqueness`
 * and two with `mandatory` for this reason -- the false-miss shape
 * barwise-892 and barwise-896 both fixed. Nothing exercised either
 * widening: dropping `isExternalUniqueness` or `isDisjunctiveMandatory`
 * left all 95 learn tests green, all 43 shipped `forbids_population`
 * checks discriminating, and every one of the 192 committed payloads
 * scoring identically. The same held for the `REJECTING_RULES` rule ids
 * they were carried forward from.
 *
 * Both are reachable. The external-uniqueness case took a specific
 * shape to reach, and the shape is the point: see its comment.
 */
import { OrmModel, OrmYamlSerializer } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { forbidsPopulation } from "../src/evaluate/checks/forbidsPopulation.js";

describe("a candidate may express a mandatory as a disjunctive mandatory", () => {
  /** Reference: every Vendor must have a VendorNumber. */
  function reference(): OrmModel {
    const model = new OrmModel({ name: "ref" });
    const vendor = model.addObjectType({
      name: "Vendor",
      kind: "entity",
      referenceMode: "vendor_id",
    });
    const number = model.addObjectType({ name: "VendorNumber", kind: "value" });
    const region = model.addObjectType({ name: "Region", kind: "value" });
    model.addFactType({
      name: "Vendor has VendorNumber",
      roles: [
        { name: "has", playerId: vendor.id, id: "rV" },
        { name: "of", playerId: number.id, id: "rN" },
      ],
      readings: ["{0} has {1}"],
      constraints: [{ type: "mandatory", roleId: "rV" }],
    });
    // The anchor: `forMandatory` needs somewhere a Vendor can exist
    // without playing the mandatory role, or it cannot build a
    // counterexample at all.
    model.addFactType({
      name: "Vendor operates in Region",
      roles: [
        { name: "in", playerId: vendor.id, id: "rOV" },
        { name: "of", playerId: region.id, id: "rOR" },
      ],
      readings: ["{0} operates in {1}"],
    });
    return model;
  }

  /**
   * The candidate says a Vendor must have a number OR an alias. That is
   * weaker than the reference, but it does require the number role to be
   * played when no alias is -- so a Vendor playing neither is still
   * ruled out, which is what the check asks.
   */
  function candidate(): OrmModel {
    const model = new OrmModel({ name: "cand" });
    const vendor = model.addObjectType({
      name: "Vendor",
      kind: "entity",
      referenceMode: "vendor_id",
    });
    const number = model.addObjectType({ name: "VendorNumber", kind: "value" });
    const alias = model.addObjectType({ name: "VendorAlias", kind: "value" });
    const region = model.addObjectType({ name: "Region", kind: "value" });
    model.addFactType({
      name: "Vendor has VendorNumber",
      roles: [
        { name: "has", playerId: vendor.id, id: "cV" },
        { name: "of", playerId: number.id, id: "cN" },
      ],
      readings: ["{0} has {1}"],
    });
    model.addFactType({
      name: "Vendor has VendorAlias",
      roles: [
        { name: "has", playerId: vendor.id, id: "aV" },
        { name: "of", playerId: alias.id, id: "aA" },
      ],
      readings: ["{0} has {1}"],
    });
    model.addFactType({
      name: "Vendor operates in Region",
      roles: [
        { name: "in", playerId: vendor.id, id: "cOV" },
        { name: "of", playerId: region.id, id: "cOR" },
      ],
      readings: ["{0} operates in {1}"],
    });
    // Declared after both phone-style fact types exist, because its
    // roles span them.
    model.addConstraint({ type: "disjunctive_mandatory", roleIds: ["cV", "aV"] });
    return model;
  }

  it("passes: the disjunctive mandatory rules out the minted vendor", () => {
    const result = forbidsPopulation(
      candidate(),
      reference(),
      "Vendor has VendorNumber",
      "mandatory",
    );
    expect(result.passed).toBe(true);
  });
});

describe("a candidate may express an internal uniqueness as an external one", () => {
  /**
   * Reference: each VendorNumber belongs to at most one Vendor. The
   * uniqueness sits on the VALUE role deliberately, and that is what
   * makes the external path reachable: `forUniqueness` agrees on the
   * constrained roles and differs on the rest, so constraining the
   * NUMBER mints two distinct VENDORS. External uniqueness needs two
   * distinct common-object values sharing a combination; constrain the
   * vendor role instead and the counterexample mints one vendor twice,
   * which cannot collide with itself.
   */
  function reference(): OrmModel {
    const model = new OrmModel({ name: "ref" });
    const vendor = model.addObjectType({
      name: "Vendor",
      kind: "entity",
      referenceMode: "vendor_id",
    });
    const number = model.addObjectType({ name: "VendorNumber", kind: "value" });
    model.addFactType({
      name: "Vendor has VendorNumber",
      roles: [
        { name: "has", playerId: vendor.id, id: "rV" },
        { name: "of", playerId: number.id, id: "rN" },
      ],
      readings: ["{0} has {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["rN"] }],
    });
    return model;
  }

  /**
   * The candidate identifies a Vendor by (VendorNumber, Region) -- an
   * external uniqueness spanning two fact types. The Region population
   * is load-bearing rather than decorative: the join skips any common
   * value whose tuple is incomplete, so without a region for each minted
   * vendor there is no combination to collide. A candidate carrying
   * sample populations is the ordinary case, not a contrived one -- the
   * extraction prompt asks for them.
   *
   * `nest` picks the fact type a 2.0 file nests the key under: one it
   * spans, or a third that has nothing to do with it. Neither changes which
   * fact types the key applies to (orm-format-3, Open decision 9). In
   * memory the key belongs to the model (WS3c), so the model is read back
   * from such a file.
   */
  function candidate(nest: "number" | "unrelated" = "number"): OrmModel {
    const model = new OrmModel({ name: "cand" });
    const vendor = model.addObjectType({
      name: "Vendor",
      kind: "entity",
      referenceMode: "vendor_id",
    });
    const number = model.addObjectType({ name: "VendorNumber", kind: "value" });
    const region = model.addObjectType({ name: "Region", kind: "value" });
    model.addFactType({
      name: "Vendor has VendorNumber",
      roles: [
        { name: "has", playerId: vendor.id, id: "cV" },
        { name: "of", playerId: number.id, id: "cN" },
      ],
      readings: ["{0} has {1}"],
    });
    const regionFt = model.addFactType({
      name: "Vendor operates in Region",
      roles: [
        { name: "in", playerId: vendor.id, id: "gV" },
        { name: "of", playerId: region.id, id: "gR" },
      ],
      readings: ["{0} operates in {1}"],
    });
    model.addFactType({
      name: "Vendor is audited",
      roles: [{ name: "is audited", playerId: vendor.id, id: "aV" }],
      readings: ["{0} is audited"],
    });
    model.addConstraint({ id: "c-key", type: "external_uniqueness", roleIds: ["cN", "gR"] });

    // The two vendors `forUniqueness` mints, both in one region.
    const pop = model.addPopulation({ factTypeId: regionFt.id });
    pop.addInstance({ roleValues: { gV: "Vendor#1", gR: "EMEA" } });
    pop.addInstance({ roleValues: { gV: "Vendor#2", gR: "EMEA" } });
    return nestedUnder(
      model,
      nest === "number" ? "Vendor has VendorNumber" : "Vendor is audited",
      "c-key",
    );
  }

  /**
   * `model` read back from a 2.0 file nesting constraint `id` under `host`.
   * A save writes 3.0, where the external uniqueness sits in the model's own
   * list and each preferred identifier is a reference on its entity; the 2.0
   * form nests the one and flags the other.
   */
  function nestedUnder(model: OrmModel, host: string, id: string): OrmModel {
    const yaml = new OrmYamlSerializer();
    type Raw = { id: string; is_preferred?: boolean; };
    type NestedFactType = { name: string; constraints?: Raw[]; };
    const doc = parse(yaml.serialize(model)) as {
      orm_version: string;
      model: {
        fact_types: NestedFactType[];
        constraints?: Raw[];
        object_types?: { preferred_identifier?: string; }[];
      };
    };
    doc.orm_version = "2.0";
    const fts = doc.model.fact_types;
    const moved = (doc.model.constraints ?? []).find((c) => c.id === id)!;
    delete doc.model.constraints;
    const target = fts.find((ft) => ft.name === host)!;
    target.constraints = [...(target.constraints ?? []), moved];
    const byId = new Map(fts.flatMap((ft) => ft.constraints ?? []).map((c) => [c.id, c]));
    for (const ot of doc.model.object_types ?? []) {
      const ref = ot.preferred_identifier;
      delete ot.preferred_identifier;
      const c = ref === undefined ? undefined : byId.get(ref);
      if (c) c.is_preferred = true;
    }
    return yaml.deserialize(stringify(doc));
  }

  it("passes: the external uniqueness rejects the two vendors sharing a number", () => {
    for (const nest of ["number", "unrelated"] as const) {
      const result = forbidsPopulation(
        candidate(nest),
        reference(),
        "Vendor has VendorNumber",
        "internal_uniqueness",
      );
      expect(result.passed, nest).toBe(true);
    }
  });
});
