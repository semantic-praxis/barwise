/**
 * Objectification-aware correspondence
 * (docs/specs/objectified-correspondence.spec.md, barwise-881).
 *
 * The shape under test is audit finding F6: the reference settles
 * "at most one grade per (student, offering)" as a ternary with a
 * spanning uniqueness, and an equally correct candidate objectifies
 * the enrollment pair and hangs the grade off it. The check must pass
 * both shapes when they carry the rule, fail the objectified shape
 * when it drops the rule, and leave flat correspondence byte-identical.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { forbidsPopulation } from "../src/evaluate/checks/forbidsPopulation.js";

/** The reference's shape: the ternary, uniqueness spanning Student+CourseOffering. */
function referenceModel(): OrmModel {
  const model = new OrmModel({ name: "ref" });
  const student = model.addObjectType({
    name: "Student",
    kind: "entity",
    referenceMode: "student_number",
  });
  const offering = model.addObjectType({
    name: "CourseOffering",
    kind: "entity",
    referenceMode: "offering_id",
  });
  const grade = model.addObjectType({ name: "LetterGrade", kind: "value" });
  model.addFactType({
    name: "Student receives LetterGrade for CourseOffering",
    roles: [
      { name: "receives", playerId: student.id, id: "rS" },
      { name: "is received by", playerId: grade.id, id: "rG" },
      { name: "grades", playerId: offering.id, id: "rC" },
    ],
    readings: ["{0} receives {1} for {2}"],
    constraints: [{ type: "internal_uniqueness", roleIds: ["rS", "rC"] }],
  });
  return model;
}

/** The other correct shape: Enrollment objectifies the pair and carries the grade. */
function objectifiedCandidate(withRule: boolean): OrmModel {
  const model = new OrmModel({ name: "cand" });
  const student = model.addObjectType({
    name: "Student",
    kind: "entity",
    referenceMode: "student_number",
  });
  const offering = model.addObjectType({
    name: "CourseOffering",
    kind: "entity",
    referenceMode: "offering_id",
  });
  const enrollment = model.addObjectType({
    name: "Enrollment",
    kind: "entity",
    referenceMode: "enrollment_id",
  });
  const grade = model.addObjectType({ name: "LetterGrade", kind: "value" });
  const enrolls = model.addFactType({
    name: "Student enrolls in CourseOffering",
    roles: [
      { name: "enrolls in", playerId: student.id, id: "eS" },
      { name: "has enrolled", playerId: offering.id, id: "eC" },
    ],
    readings: ["{0} enrolls in {1}"],
    constraints: [{ type: "internal_uniqueness", roleIds: ["eS", "eC"] }],
  });
  model.addFactType({
    name: "Enrollment has LetterGrade",
    roles: [
      { name: "has", playerId: enrollment.id, id: "gE" },
      { name: "is of", playerId: grade.id, id: "gG" },
    ],
    readings: ["{0} has {1}"],
    constraints: withRule ? [{ type: "internal_uniqueness", roleIds: ["gE"] }] : [],
  });
  model.addObjectifiedFactType({
    factTypeId: enrolls.id,
    objectTypeId: enrollment.id,
  });
  return model;
}

const check = (candidate: OrmModel) =>
  forbidsPopulation(
    candidate,
    referenceModel(),
    "Student receives LetterGrade for CourseOffering",
    "internal_uniqueness",
  );

describe("objectification-aware forbids_population", () => {
  it("still passes the reference's own shape (the flat tier, unchanged)", () => {
    expect(check(referenceModel()).passed).toBe(true);
  });

  it("passes the objectified shape that carries the rule", () => {
    // Two grades for one (student, offering) pair fold into one
    // synthetic Enrollment value, which the candidate's uniqueness on
    // the Enrollment role rejects -- the same semantics, other shape.
    expect(check(objectifiedCandidate(true)).passed).toBe(true);
  });

  it("fails the objectified shape that drops the rule", () => {
    const result = check(objectifiedCandidate(false));
    expect(result.passed).toBe(false);
    expect(result.message).toContain("still allows");
  });

  it("fails a candidate that has not modeled the relationship at all", () => {
    const bare = new OrmModel({ name: "bare" });
    bare.addObjectType({ name: "Student", kind: "entity", referenceMode: "student_number" });
    expect(check(bare).passed).toBe(false);
  });
});
