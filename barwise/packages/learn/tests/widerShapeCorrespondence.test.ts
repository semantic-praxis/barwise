/**
 * Wider-shape correspondence: the projection tier
 * (docs/specs/wider-shape-correspondence.spec.md, barwise-890).
 *
 * The shapes under test are the 2026-08-28 baseline's payload-verified
 * instances: a reference binary whose rule an equally correct candidate
 * carries in a WIDER fact type (sonnet's clinic 5-ary, the PlanChange
 * 5-ary), and the anchor-propagation form where the constraint's own
 * fact type matches exactly but its mandatory counterexample anchors on
 * an absorbed binary. The vacuity guard is the test that keeps the tier
 * honest: a candidate whose only uniqueness spans an extra role does
 * NOT carry the reference rule and must still fail.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { forbidsPopulation } from "../src/evaluate/checks/forbidsPopulation.js";

/** Reference: "Appointment is with Doctor", at most one Doctor per Appointment. */
function clinicReference(): OrmModel {
  const model = new OrmModel({ name: "ref" });
  const appointment = model.addObjectType({
    name: "Appointment",
    kind: "entity",
    referenceMode: "appointment_id",
  });
  const doctor = model.addObjectType({ name: "Doctor", kind: "entity", referenceMode: "npi" });
  model.addObjectType({ name: "Patient", kind: "entity", referenceMode: "mrn" });
  model.addFactType({
    name: "Appointment is with Doctor",
    roles: [
      { name: "is with", playerId: appointment.id, id: "rA" },
      { name: "attends", playerId: doctor.id, id: "rD" },
    ],
    readings: ["{0} is with {1}"],
    constraints: [{ type: "internal_uniqueness", roleIds: ["rA"] }],
  });
  return model;
}

/**
 * Candidate: the observed wider shape, a ternary absorbing the binary.
 * `uniqueness` selects which roles the candidate's one internal
 * uniqueness spans -- ["cA"] carries the reference rule, a set touching
 * the extra Patient role does not.
 */
function ternaryCandidate(uniqueness: string[]): OrmModel {
  const model = new OrmModel({ name: "cand" });
  const appointment = model.addObjectType({
    name: "Appointment",
    kind: "entity",
    referenceMode: "appointment_id",
  });
  const patient = model.addObjectType({ name: "Patient", kind: "entity", referenceMode: "mrn" });
  const doctor = model.addObjectType({ name: "Doctor", kind: "entity", referenceMode: "npi" });
  model.addFactType({
    name: "Appointment is for Patient with Doctor",
    roles: [
      { name: "is for", playerId: appointment.id, id: "cA" },
      { name: "books", playerId: patient.id, id: "cP" },
      { name: "sees", playerId: doctor.id, id: "cD" },
    ],
    readings: ["{0} is for {1} with {2}"],
    constraints: [{ type: "internal_uniqueness", roleIds: uniqueness }],
  });
  return model;
}

const clinicCheck = (candidate: OrmModel) =>
  forbidsPopulation(
    candidate,
    clinicReference(),
    "Appointment is with Doctor",
    "internal_uniqueness",
  );

describe("projection-tier forbids_population", () => {
  it("passes a wider carrier whose uniqueness spans only the shared roles", () => {
    // Two injected instances share the Appointment value and differ on
    // Doctor (from the reference counterexample) and on Patient (fresh
    // per instance); the candidate's uniqueness over the Appointment
    // role alone rejects them -- the rule is carried, wider shape.
    expect(clinicCheck(ternaryCandidate(["cA"])).passed).toBe(true);
  });

  it("fails a spanning uniqueness -- the vacuity guard", () => {
    // The same ternary whose only uniqueness spans all three roles does
    // NOT carry "at most one Doctor per Appointment". The injected
    // instances differ on the fresh Patient values, so the spanning
    // uniqueness accepts them; identical tuples would have violated it
    // and let the shape falsely pass.
    const result = clinicCheck(ternaryCandidate(["cA", "cP", "cD"]));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("still allows");
    expect(result.message).toContain(
      'possibly carried in the wider fact type "Appointment is for Patient with Doctor"',
    );
  });

  it("fails a uniqueness spanning a shared and an extra role", () => {
    // Over [Appointment, Patient] the injection is unique on the fresh
    // Patient values, so nothing fires -- the same vacuity, narrower.
    expect(clinicCheck(ternaryCandidate(["cA", "cP"])).passed).toBe(false);
  });

  it("repairs anchor propagation: a mandatory whose counterexample anchors on an absorbed binary", () => {
    // Reference: "Doctor has Specialty" is mandatory for Doctor, and the
    // counterexample witnesses a Doctor existing via "Appointment is
    // with Doctor" -- a binary the candidate absorbed into its ternary.
    const reference = new OrmModel({ name: "ref" });
    const doctor = reference.addObjectType({
      name: "Doctor",
      kind: "entity",
      referenceMode: "npi",
    });
    const specialty = reference.addObjectType({ name: "Specialty", kind: "value" });
    const appointment = reference.addObjectType({
      name: "Appointment",
      kind: "entity",
      referenceMode: "appointment_id",
    });
    reference.addObjectType({ name: "Patient", kind: "entity", referenceMode: "mrn" });
    reference.addFactType({
      name: "Doctor has Specialty",
      roles: [
        { name: "has", playerId: doctor.id, id: "sD" },
        { name: "is of", playerId: specialty.id, id: "sS" },
      ],
      readings: ["{0} has {1}"],
      constraints: [{ type: "mandatory", roleId: "sD" }],
    });
    reference.addFactType({
      name: "Appointment is with Doctor",
      roles: [
        { name: "is with", playerId: appointment.id, id: "aA" },
        { name: "attends", playerId: doctor.id, id: "aD" },
      ],
      readings: ["{0} is with {1}"],
    });

    const candidate = (withMandatory: boolean): OrmModel => {
      const model = ternaryCandidate(["cA"]);
      const cDoctor = model.getObjectTypeByName("Doctor")!;
      const cSpecialty = model.addObjectType({ name: "Specialty", kind: "value" });
      model.addFactType({
        name: "Doctor has Specialty",
        roles: [
          { name: "has", playerId: cDoctor.id, id: "kD" },
          { name: "is of", playerId: cSpecialty.id, id: "kS" },
        ],
        readings: ["{0} has {1}"],
        constraints: withMandatory ? [{ type: "mandatory", roleId: "kD" }] : [],
      });
      return model;
    };

    const check = (model: OrmModel) =>
      forbidsPopulation(model, reference, "Doctor has Specialty", "mandatory");
    // The candidate's own "Doctor has Specialty" matches exactly; only
    // the anchor population needs the projection tier. With the
    // mandatory declared, the injected Doctor exists in the ternary but
    // plays no specialty, and the candidate rejects it.
    expect(check(candidate(true)).passed).toBe(true);
    expect(check(candidate(false)).passed).toBe(false);
  });

  it("passes the observed PlanChange 5-ary", () => {
    const reference = new OrmModel({ name: "ref" });
    const planChange = reference.addObjectType({
      name: "PlanChange",
      kind: "entity",
      referenceMode: "change_id",
    });
    const subscription = reference.addObjectType({
      name: "Subscription",
      kind: "entity",
      referenceMode: "subscription_id",
    });
    reference.addFactType({
      name: "PlanChange is for Subscription",
      roles: [
        { name: "is for", playerId: planChange.id, id: "rP" },
        { name: "undergoes", playerId: subscription.id, id: "rS" },
      ],
      readings: ["{0} is for {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["rP"] }],
    });

    const candidate = new OrmModel({ name: "cand" });
    const cChange = candidate.addObjectType({
      name: "PlanChange",
      kind: "entity",
      referenceMode: "change_id",
    });
    const cSub = candidate.addObjectType({
      name: "Subscription",
      kind: "entity",
      referenceMode: "subscription_id",
    });
    const plan = candidate.addObjectType({
      name: "PricePlan",
      kind: "entity",
      referenceMode: "plan_code",
    });
    const date = candidate.addObjectType({ name: "EffectiveDate", kind: "value" });
    const requester = candidate.addObjectType({
      name: "Requester",
      kind: "entity",
      referenceMode: "user_id",
    });
    candidate.addFactType({
      name: "PlanChange records Subscription with new PricePlan on EffectiveDate by Requester",
      roles: [
        { name: "records", playerId: cChange.id, id: "cC" },
        { name: "is recorded for", playerId: cSub.id, id: "cS" },
        { name: "moves to", playerId: plan.id, id: "cP" },
        { name: "takes effect", playerId: date.id, id: "cE" },
        { name: "is requested by", playerId: requester.id, id: "cR" },
      ],
      readings: ["{0} records {1} with new {2} on {3} by {4}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["cC"] }],
    });

    const result = forbidsPopulation(
      candidate,
      reference,
      "PlanChange is for Subscription",
      "internal_uniqueness",
    );
    expect(result.passed).toBe(true);
  });

  it("tries every wider carrier and passes when any rejects", () => {
    // Two carriers contain {Appointment, Doctor}. The narrower ternary
    // is tried first (ascending arity) and its spanning uniqueness does
    // not reject; the wider 4-ary carries the rule and does.
    const model = ternaryCandidate(["cA", "cP", "cD"]);
    const appointment = model.getObjectTypeByName("Appointment")!;
    const patient = model.getObjectTypeByName("Patient")!;
    const doctor = model.getObjectTypeByName("Doctor")!;
    const date = model.addObjectType({ name: "Date", kind: "value" });
    model.addFactType({
      name: "Appointment is for Patient with Doctor on Date",
      roles: [
        { name: "is for", playerId: appointment.id, id: "qA" },
        { name: "books", playerId: patient.id, id: "qP" },
        { name: "sees", playerId: doctor.id, id: "qD" },
        { name: "falls on", playerId: date.id, id: "qT" },
      ],
      readings: ["{0} is for {1} with {2} on {3}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["qA"] }],
    });
    expect(clinicCheck(model).passed).toBe(true);
  });

  it("names every carrier tried when none rejects", () => {
    const model = ternaryCandidate(["cA", "cP", "cD"]);
    const appointment = model.getObjectTypeByName("Appointment")!;
    const patient = model.getObjectTypeByName("Patient")!;
    const doctor = model.getObjectTypeByName("Doctor")!;
    const date = model.addObjectType({ name: "Date", kind: "value" });
    model.addFactType({
      name: "Appointment is for Patient with Doctor on Date",
      roles: [
        { name: "is for", playerId: appointment.id, id: "qA" },
        { name: "books", playerId: patient.id, id: "qP" },
        { name: "sees", playerId: doctor.id, id: "qD" },
        { name: "falls on", playerId: date.id, id: "qT" },
      ],
      readings: ["{0} is for {1} with {2} on {3}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["qA", "qP", "qD", "qT"] }],
    });
    const result = clinicCheck(model);
    expect(result.passed).toBe(false);
    expect(result.message).toContain('"Appointment is for Patient with Doctor"');
    expect(result.message).toContain('"Appointment is for Patient with Doctor on Date"');
  });

  it("still passes the reference's own shape (the flat tier, unchanged)", () => {
    expect(clinicCheck(clinicReference()).passed).toBe(true);
  });
});
