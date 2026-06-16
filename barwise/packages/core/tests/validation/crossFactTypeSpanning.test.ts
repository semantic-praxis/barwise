/**
 * Tests for spanning cross-fact-type population validation (WS4a cont.):
 * exclusion, exclusive-or, subset, and equality whose roles span two fact
 * types.
 */
import { describe, expect, it } from "vitest";
import type { FactType } from "../../src/model/FactType.js";
import type { ObjectType } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";

interface RoleSpec {
  readonly player: ObjectType;
  readonly name: string;
  readonly id: string;
}

function ent(m: OrmModel, name: string, ref: string): ObjectType {
  return m.addObjectType({ name, kind: "entity", referenceMode: ref });
}

function val(m: OrmModel, name: string): ObjectType {
  return m.addObjectType({ name, kind: "value" });
}

function binaryFact(m: OrmModel, name: string, a: RoleSpec, b: RoleSpec): FactType {
  return m.addFactType({
    name,
    roles: [
      { name: a.name, playerId: a.player.id, id: a.id },
      { name: b.name, playerId: b.player.id, id: b.id },
    ],
    readings: ["{0} relates {1}"],
  });
}

function pop(m: OrmModel, factTypeId: string, roleValues: Record<string, string>): void {
  m.addPopulation({ factTypeId }).addInstance({ roleValues });
}

function flags(model: OrmModel, ruleId: string): boolean {
  return populationValidationRules(model).some((d) => d.ruleId === ruleId);
}

/** Person drives Car / rides Bus, with exclusion across the two Person roles. */
function exclusionModel(violate: boolean): OrmModel {
  const m = new OrmModel({ name: "M" });
  const person = ent(m, "Person", "person_id");
  const car = ent(m, "Car", "vin");
  const bus = ent(m, "Bus", "bus_id");
  const drives = binaryFact(
    m,
    "Person drives Car",
    { player: person, name: "drives", id: "d1" },
    { player: car, name: "driven by", id: "d2" },
  );
  const rides = binaryFact(
    m,
    "Person rides Bus",
    { player: person, name: "rides", id: "r1" },
    { player: bus, name: "ridden by", id: "r2" },
  );
  drives.addConstraint({ type: "exclusion", roleIds: ["d1", "r1"] });
  pop(m, drives.id, { d1: "P1", d2: "CAR1" });
  pop(m, rides.id, { r1: violate ? "P1" : "P2", r2: "BUS1" });
  return m;
}

/** Person identified, drives Car / rides Bus, exclusive-or across the Person roles. */
function xorModel(violate: boolean): OrmModel {
  const m = new OrmModel({ name: "M" });
  const person = ent(m, "Person", "person_id");
  const personId = val(m, "PersonId");
  const car = ent(m, "Car", "vin");
  const bus = ent(m, "Bus", "bus_id");
  const idFt = binaryFact(
    m,
    "Person has PersonId",
    { player: person, name: "has", id: "pid1" },
    { player: personId, name: "identifies", id: "pid2" },
  );
  const drives = binaryFact(
    m,
    "Person drives Car",
    { player: person, name: "drives", id: "d1" },
    { player: car, name: "driven by", id: "d2" },
  );
  const rides = binaryFact(
    m,
    "Person rides Bus",
    { player: person, name: "rides", id: "r1" },
    { player: bus, name: "ridden by", id: "r2" },
  );
  drives.addConstraint({ type: "exclusive_or", roleIds: ["d1", "r1"] });
  pop(m, idFt.id, { pid1: "P1", pid2: "PID1" });
  pop(m, drives.id, { d1: "P1", d2: "CAR1" });
  if (violate) {
    pop(m, rides.id, { r1: "P1", r2: "BUS1" }); // P1 plays both -> count 2
  }
  return m;
}

/** Person teaches Course must be a subset of Person enrolled in Course. */
function subsetModel(violate: boolean): OrmModel {
  const m = new OrmModel({ name: "M" });
  const person = ent(m, "Person", "person_id");
  const course = ent(m, "Course", "course_code");
  const teaches = binaryFact(
    m,
    "Person teaches Course",
    { player: person, name: "teaches", id: "t1" },
    { player: course, name: "taught by", id: "t2" },
  );
  const enrolled = binaryFact(
    m,
    "Person enrolled in Course",
    { player: person, name: "enrolled in", id: "e1" },
    { player: course, name: "enrolls", id: "e2" },
  );
  teaches.addConstraint({
    type: "subset",
    subsetRoleIds: ["t1", "t2"],
    supersetRoleIds: ["e1", "e2"],
  });
  pop(m, teaches.id, { t1: "P1", t2: "C1" });
  if (!violate) {
    pop(m, enrolled.id, { e1: "P1", e2: "C1" });
  }
  return m;
}

/** Person manages Dept iff Person works in Dept (equality across two fact types). */
function equalityModel(violate: boolean): OrmModel {
  const m = new OrmModel({ name: "M" });
  const person = ent(m, "Person", "person_id");
  const dept = ent(m, "Dept", "dept_code");
  const manages = binaryFact(
    m,
    "Person manages Dept",
    { player: person, name: "manages", id: "mg1" },
    { player: dept, name: "managed by", id: "mg2" },
  );
  const works = binaryFact(
    m,
    "Person works in Dept",
    { player: person, name: "works in", id: "wk1" },
    { player: dept, name: "employs", id: "wk2" },
  );
  manages.addConstraint({
    type: "equality",
    roleIds1: ["mg1", "mg2"],
    roleIds2: ["wk1", "wk2"],
  });
  pop(m, manages.id, { mg1: "P1", mg2: "D1" });
  if (!violate) {
    pop(m, works.id, { wk1: "P1", wk2: "D1" });
  }
  return m;
}

describe("spanning exclusion", () => {
  it("flags a value playing more than one excluded role", () => {
    expect(flags(exclusionModel(true), "population/exclusion-violation")).toBe(true);
  });
  it("passes when no value plays more than one", () => {
    expect(flags(exclusionModel(false), "population/exclusion-violation")).toBe(false);
  });
});

describe("spanning exclusive-or", () => {
  it("flags a value that plays more than one of the roles", () => {
    expect(flags(xorModel(true), "population/exclusive-or-violation")).toBe(true);
  });
  it("passes when the value plays exactly one", () => {
    expect(flags(xorModel(false), "population/exclusive-or-violation")).toBe(false);
  });
});

describe("spanning subset", () => {
  it("flags a subset tuple with no superset match", () => {
    expect(flags(subsetModel(true), "population/subset-violation")).toBe(true);
  });
  it("passes when every subset tuple has a superset match", () => {
    expect(flags(subsetModel(false), "population/subset-violation")).toBe(false);
  });
});

describe("spanning equality", () => {
  it("flags a tuple present on one side but not the other", () => {
    expect(flags(equalityModel(true), "population/equality-violation")).toBe(true);
  });
  it("passes when both tuple sets are identical", () => {
    expect(flags(equalityModel(false), "population/equality-violation")).toBe(false);
  });
});
