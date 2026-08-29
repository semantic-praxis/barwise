/**
 * Attributable rejection: a `forbids_population` check may pass only
 * when the constraint it names is what rejects the population
 * (docs/specs/attributable-rejection.spec.md, barwise-894).
 *
 * Both shapes here passed before the fix, which is the point: the
 * candidate does NOT carry the rule under test, and the injection
 * tripped some other constraint instead. The rubric audit found 18 such
 * checks in the shipped eval suite, 16 of them uniqueness-subject.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { forbidsPopulation } from "../src/evaluate/checks/forbidsPopulation.js";

/** Reference: "Vendor has VendorNumber", at most one number per vendor. */
function uniquenessReference(): OrmModel {
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
 * Candidate with the SAME shape but no uniqueness -- and a mandatory on
 * the vendor role. Before the fix the injected duplicate tripped that
 * mandatory (the minted second number's vendor plays no other role) and
 * the uniqueness check passed on a model with no uniqueness at all.
 */
function uniquenessCandidate(withUniqueness: boolean): OrmModel {
  const model = new OrmModel({ name: "cand" });
  const vendor = model.addObjectType({
    name: "Vendor",
    kind: "entity",
    referenceMode: "vendor_id",
  });
  const number = model.addObjectType({ name: "VendorNumber", kind: "value" });
  const status = model.addObjectType({ name: "VendorStatus", kind: "value" });
  model.addFactType({
    name: "Vendor has VendorNumber",
    roles: [
      { name: "has", playerId: vendor.id, id: "cV" },
      { name: "of", playerId: number.id, id: "cN" },
    ],
    readings: ["{0} has {1}"],
    constraints: withUniqueness ? [{ type: "internal_uniqueness", roleIds: ["cV"] }] : [],
  });
  model.addFactType({
    name: "Vendor has VendorStatus",
    roles: [
      { name: "has", playerId: vendor.id, id: "sV" },
      { name: "of", playerId: status.id, id: "sS" },
    ],
    readings: ["{0} has {1}"],
    constraints: [{ type: "mandatory", roleId: "sV" }],
  });
  return model;
}

describe("rejection must be attributable to the constraint under test", () => {
  it("passes when the candidate carries the uniqueness", () => {
    const result = forbidsPopulation(
      uniquenessCandidate(true),
      uniquenessReference(),
      "Vendor has VendorNumber",
      "internal_uniqueness",
    );
    expect(result.passed).toBe(true);
  });

  it("fails when only an unrelated mandatory rejects the injection", () => {
    const result = forbidsPopulation(
      uniquenessCandidate(false),
      uniquenessReference(),
      "Vendor has VendorNumber",
      "internal_uniqueness",
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain("still allows");
  });
});

/** Reference: every Vendor must have a VendorNumber. */
function mandatoryReference(): OrmModel {
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
  // The anchor: somewhere a Vendor can exist without playing the
  // mandatory role. `forMandatory` needs one or it cannot build a
  // counterexample at all.
  model.addFactType({
    name: "Vendor operates in Region",
    roles: [
      { name: "operates in", playerId: vendor.id, id: "rOV" },
      { name: "of", playerId: region.id, id: "rOR" },
    ],
    readings: ["{0} operates in {1}"],
    constraints: [],
  });
  return model;
}

/**
 * `onNumber` puts the mandatory where the reference has it; otherwise
 * the candidate requires a STATUS instead. Both reject the anchor
 * injection -- the minted vendor plays neither role -- so before the fix
 * the check passed either way, and a candidate could satisfy every
 * mandatory check by declaring one unrelated mandatory.
 */
function mandatoryCandidate(onNumber: boolean): OrmModel {
  const model = new OrmModel({ name: "cand" });
  const vendor = model.addObjectType({
    name: "Vendor",
    kind: "entity",
    referenceMode: "vendor_id",
  });
  const number = model.addObjectType({ name: "VendorNumber", kind: "value" });
  const region = model.addObjectType({ name: "Region", kind: "value" });
  const status = model.addObjectType({ name: "VendorStatus", kind: "value" });
  model.addFactType({
    name: "Vendor has VendorNumber",
    roles: [
      { name: "has", playerId: vendor.id, id: "cV" },
      { name: "of", playerId: number.id, id: "cN" },
    ],
    readings: ["{0} has {1}"],
    constraints: onNumber ? [{ type: "mandatory", roleId: "cV" }] : [],
  });
  model.addFactType({
    name: "Vendor operates in Region",
    roles: [
      { name: "operates in", playerId: vendor.id, id: "cOV" },
      { name: "of", playerId: region.id, id: "cOR" },
    ],
    readings: ["{0} operates in {1}"],
    constraints: [],
  });
  model.addFactType({
    name: "Vendor has VendorStatus",
    roles: [
      { name: "has", playerId: vendor.id, id: "cSV" },
      { name: "of", playerId: status.id, id: "cSS" },
    ],
    readings: ["{0} has {1}"],
    constraints: onNumber ? [] : [{ type: "mandatory", roleId: "cSV" }],
  });
  return model;
}

describe("mandatory rejection must name the fact type the check names", () => {
  it("passes when the mandatory sits where the reference puts it", () => {
    const result = forbidsPopulation(
      mandatoryCandidate(true),
      mandatoryReference(),
      "Vendor has VendorNumber",
      "mandatory",
    );
    expect(result.passed).toBe(true);
  });

  it("fails when the candidate's mandatory is on a different fact type", () => {
    const result = forbidsPopulation(
      mandatoryCandidate(false),
      mandatoryReference(),
      "Vendor has VendorNumber",
      "mandatory",
    );
    expect(result.passed).toBe(false);
  });
});
