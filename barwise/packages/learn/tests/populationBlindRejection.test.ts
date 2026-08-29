/**
 * Population-blind rejection (barwise-895,
 * docs/specs/population-blind-rejection.spec.md): `candidateRejects`
 * judges by errors the injection CAUSED (a before/after multiset),
 * not by errors attributed to the injected population's id -- an
 * attribution the mandatory rule never provides. The shape under test
 * is the opus probe's: a candidate that declares the reference's
 * mandatory AND carries an example population, exactly what the
 * extraction prompt instructs, previously failed every mandatory
 * check with "still allows".
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { forbidsPopulation } from "../src/evaluate/checks/forbidsPopulation.js";

/** The shared shape: an identifier fact type (the mandatory's anchor)
 *  and the guarded binary, with the billing mandatory optional. */
function model(billingMandatory: boolean): OrmModel {
  const m = new OrmModel({ name: "m" });
  const sub = m.addObjectType({
    name: "Subscription",
    kind: "entity",
    referenceMode: "subscription_id",
  });
  const sid = m.addObjectType({ name: "SubscriptionId", kind: "value" });
  const bp = m.addObjectType({ name: "BillingPeriod", kind: "value" });
  m.addFactType({
    name: "Subscription has SubscriptionId",
    roles: [
      { name: "has", playerId: sub.id, id: "iS" },
      { name: "identifies", playerId: sid.id, id: "iV" },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { type: "internal_uniqueness", roleIds: ["iS"], isPreferred: true },
      { type: "mandatory", roleId: "iS" },
    ],
  });
  m.addFactType({
    name: "Subscription has BillingPeriod",
    roles: [
      { name: "has", playerId: sub.id, id: "bS" },
      { name: "is of", playerId: bp.id, id: "bV" },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { type: "internal_uniqueness", roleIds: ["bS"] },
      ...(billingMandatory ? [{ type: "mandatory", roleId: "bS" } as const] : []),
    ],
  });
  return m;
}

const reference = (): OrmModel => model(true);

/** The reference's own shape, with the billing mandatory optional and
 *  optionally one sample population -- the extraction-payload shape. */
function candidate(
  options: { billingMandatory: boolean; withPopulation: boolean; },
): OrmModel {
  const m = model(options.billingMandatory);
  if (options.withPopulation) {
    const idFt = m.getFactTypeByName("Subscription has SubscriptionId")!;
    m.addPopulation({
      factTypeId: idFt.id,
      sample: true,
      instances: [{ roleValues: { iS: "SUB-9", iV: "SUB-9" } }],
    });
  }
  return m;
}

const check = (m: OrmModel) =>
  forbidsPopulation(m, reference(), "Subscription has BillingPeriod", "mandatory");

describe("forbids_population on a candidate with its own populations", () => {
  it("passes a declared mandatory whether or not the candidate carries a population", () => {
    // The reproduction that filed barwise-895: identical models, and
    // the populated one previously failed because the mandatory
    // violation's elementId is the constraint, never the injected
    // population.
    expect(check(candidate({ billingMandatory: true, withPopulation: false })).passed).toBe(true);
    expect(check(candidate({ billingMandatory: true, withPopulation: true })).passed).toBe(true);
  });

  it("still fails a missing mandatory when the candidate carries a population", () => {
    const result = check(candidate({ billingMandatory: false, withPopulation: true }));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("still allows");
  });

  it("does not let a pre-existing own-data violation count as rejection", () => {
    // The candidate's own population already violates its identifier
    // uniqueness (two facts sharing the Subscription role). Those
    // errors exist before AND after the injection, so they cancel --
    // the intent of the old elementId filter, kept by the delta. With
    // the billing mandatory missing, the check must still fail.
    const m = candidate({ billingMandatory: false, withPopulation: false });
    const idFt = m.getFactTypeByName("Subscription has SubscriptionId")!;
    m.addPopulation({
      factTypeId: idFt.id,
      sample: true,
      instances: [
        { roleValues: { iS: "SUB-9", iV: "SUB-9" } },
        { roleValues: { iS: "SUB-9", iV: "SUB-10" } },
      ],
    });
    const result = check(m);
    expect(result.passed).toBe(false);
    expect(result.message).toContain("still allows");
  });
});
