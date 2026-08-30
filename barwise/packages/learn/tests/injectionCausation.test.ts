/**
 * A `forbids_population` check passes only when the INJECTION is what
 * makes the named constraint reject (barwise-904, workstream 2).
 *
 * `evaluateConstraintEnforcement` answers "does this constraint reject
 * this model's population" -- which, on a candidate carrying populations
 * of its own, is already true before anything is injected. The check
 * therefore compares the same constraint's diagnostics before and after,
 * and these are the tests that make that comparison load-bearing rather
 * than incidental: remove it and both cases below pass on a candidate
 * that does not carry the rule.
 *
 * Neither invariant was pinned before this file. Dropping the delta from
 * the previous, diagnostic-based implementation left all 97 tests green
 * and all 43 shipped `forbids_population` checks discriminating, so
 * nothing anywhere would have reported it.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { forbidsPopulation } from "../src/evaluate/checks/forbidsPopulation.js";

/** Reference: at most one number per vendor. */
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
    constraints: [{ type: "internal_uniqueness", roleIds: ["rV"] }],
  });
  return model;
}

/**
 * The candidate puts its uniqueness on the WRONG role -- one number per
 * vendor is what the reference asks; this says one vendor per number --
 * and carries a population that already violates it. The check must
 * still fail: the rule under test is absent, and the rejection the
 * candidate does produce was there before anything was injected.
 */
function selfViolatingCandidate(): OrmModel {
  const model = new OrmModel({ name: "cand" });
  const vendor = model.addObjectType({
    name: "Vendor",
    kind: "entity",
    referenceMode: "vendor_id",
  });
  const number = model.addObjectType({ name: "VendorNumber", kind: "value" });
  const ft = model.addFactType({
    name: "Vendor has VendorNumber",
    roles: [
      { name: "has", playerId: vendor.id, id: "cV" },
      { name: "of", playerId: number.id, id: "cN" },
    ],
    readings: ["{0} has {1}"],
    constraints: [{ type: "internal_uniqueness", roleIds: ["cN"] }],
  });
  // Two vendors sharing a number: the candidate's own data breaks its
  // own constraint, so it rejects before the check injects anything.
  const pop = model.addPopulation({ factTypeId: ft.id });
  pop.addInstance({ roleValues: { cV: "V1", cN: "N1" } });
  pop.addInstance({ roleValues: { cV: "V2", cN: "N1" } });
  return model;
}

describe("rejection must be caused by the injection", () => {
  it("fails when the candidate's own population already violates its constraint", () => {
    const result = forbidsPopulation(
      selfViolatingCandidate(),
      reference(),
      "Vendor has VendorNumber",
      "internal_uniqueness",
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain("still allows");
  });

  it("still passes the same candidate once it carries the rule under test", () => {
    // Same self-violating population, plus the uniqueness the reference
    // asks for. The pre-existing violation must not mask the caused one.
    const model = selfViolatingCandidate();
    const ft = model.getFactTypeByName("Vendor has VendorNumber")!;
    ft.addConstraint({ type: "internal_uniqueness", roleIds: ["cV"] });

    const result = forbidsPopulation(
      model,
      reference(),
      "Vendor has VendorNumber",
      "internal_uniqueness",
    );
    expect(result.passed).toBe(true);
  });
});
