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
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
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
    const numberFt = model.addFactType({
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
    numberFt.addConstraint({ type: "disjunctive_mandatory", roleIds: ["cV", "aV"] });
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
   */
  function candidate(): OrmModel {
    const model = new OrmModel({ name: "cand" });
    const vendor = model.addObjectType({
      name: "Vendor",
      kind: "entity",
      referenceMode: "vendor_id",
    });
    const number = model.addObjectType({ name: "VendorNumber", kind: "value" });
    const region = model.addObjectType({ name: "Region", kind: "value" });
    const numberFt = model.addFactType({
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
    numberFt.addConstraint({ type: "external_uniqueness", roleIds: ["cN", "gR"] });

    // The two vendors `forUniqueness` mints, both in one region.
    const pop = model.addPopulation({ factTypeId: regionFt.id });
    pop.addInstance({ roleValues: { gV: "Vendor#1", gR: "EMEA" } });
    pop.addInstance({ roleValues: { gV: "Vendor#2", gR: "EMEA" } });
    return model;
  }

  it("passes: the external uniqueness rejects the two vendors sharing a number", () => {
    const result = forbidsPopulation(
      candidate(),
      reference(),
      "Vendor has VendorNumber",
      "internal_uniqueness",
    );
    expect(result.passed).toBe(true);
  });
});
