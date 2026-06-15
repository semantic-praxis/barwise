import {
  type Constraint,
  type FrequencyConstraint,
  type InternalUniquenessConstraint,
  isFrequency,
  isInternalUniqueness,
  isRing,
  isValueConstraint,
  type RingConstraint,
  type ValueConstraint,
} from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { OrmModel } from "../model/OrmModel.js";
import { Population } from "../model/Population.js";
import type { Role } from "../model/Role.js";
import {
  kwSeg,
  textSeg,
  valSeg,
  type VerbalizationSegment,
} from "../verbalization/Verbalization.js";
import type { Counterexample } from "./Counterexample.js";
import { mintInvalidValue, mintValue, playerName } from "./values.js";

type RoleValues = Record<string, string>;

/**
 * Generate a counterexample for every constraint in the model that has
 * one. A counterexample is the minimal population a constraint forbids;
 * it is the deterministic inverse of population validation.
 *
 * Covers the intra-fact-type constraints whose violations a single
 * population can express: internal uniqueness, value, frequency, and
 * ring. Cross-fact-type constraints (mandatory, exclusion, subset, ...)
 * have no counterexample yet and are skipped.
 */
export function generateCounterexamples(model: OrmModel): Counterexample[] {
  const result: Counterexample[] = [];
  for (const factType of model.factTypes) {
    for (const constraint of factType.constraints) {
      const ce = generateCounterexampleForConstraint(constraint, factType, model);
      if (ce) {
        result.push(ce);
      }
    }
  }
  return result;
}

/** Generate the counterexample for a single constraint, if one exists. */
export function generateCounterexampleForConstraint(
  constraint: Constraint,
  factType: FactType,
  model: OrmModel,
): Counterexample | undefined {
  if (isInternalUniqueness(constraint)) {
    return forUniqueness(constraint, factType, model);
  }
  if (isValueConstraint(constraint)) {
    return forValue(constraint, factType, model);
  }
  if (isFrequency(constraint)) {
    return forFrequency(constraint, factType, model);
  }
  if (isRing(constraint)) {
    return forRing(constraint, factType, model);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Per-constraint generators
// ---------------------------------------------------------------------------

function forUniqueness(
  uc: InternalUniquenessConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  const roles = ft.roles;
  if (roles.length === 0) return undefined;

  const constrained = new Set(uc.roleIds);
  const inst1: RoleValues = {};
  const inst2: RoleValues = {};
  for (const role of roles) {
    if (constrained.has(role.id)) {
      const shared = mintValue(role, ft, model, 0);
      inst1[role.id] = shared;
      inst2[role.id] = shared;
    } else {
      // Differ on an unconstrained role so the two facts are distinct yet
      // collide on the constrained role set.
      inst1[role.id] = mintValue(role, ft, model, 0);
      inst2[role.id] = mintValue(role, ft, model, 1);
    }
  }

  const names = uc.roleIds
    .map((rid) => roles.find((r) => r.id === rid))
    .filter((r): r is Role => r !== undefined)
    .map((r) => playerName(r, model));
  const reason = `two facts of ${ft.name} that agree on `
    + `${names.join(", ") || "the constrained role(s)"}`;
  return makeCounterexample(ft, uc, [inst1, inst2], reason, model);
}

function forValue(
  vc: ValueConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  if (!vc.roleId) return undefined; // type-level value constraints have no role to probe
  const role = ft.roles.find((r) => r.id === vc.roleId);
  if (!role) return undefined;

  const invalid = mintInvalidValue(vc.values, role, model);
  const inst: RoleValues = {};
  for (const r of ft.roles) {
    inst[r.id] = r.id === vc.roleId ? invalid : mintValue(r, ft, model, 0);
  }

  const reason = `${playerName(role, model)} taking a value outside `
    + `{${vc.values.join(", ")}}`;
  return makeCounterexample(ft, vc, [inst], reason, model);
}

function forFrequency(
  fc: FrequencyConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  const role = ft.roles.find((r) => r.id === fc.roleId);
  if (!role) return undefined;

  const name = playerName(role, model);
  let count: number;
  let reason: string;
  if (fc.max !== "unbounded") {
    count = fc.max + 1; // exceed the upper bound
    reason = `the same ${name} in ${ft.name} more than ${fc.max} time(s)`;
  } else if (fc.min > 1) {
    count = fc.min - 1; // fall short of the lower bound
    reason = `a ${name} in ${ft.name} fewer than ${fc.min} time(s)`;
  } else {
    return undefined; // min <= 1 and unbounded max forbids nothing
  }

  const shared = mintValue(role, ft, model, 0);
  const instances: RoleValues[] = [];
  for (let i = 0; i < count; i++) {
    const inst: RoleValues = {};
    for (const r of ft.roles) {
      inst[r.id] = r.id === fc.roleId ? shared : mintValue(r, ft, model, i);
    }
    instances.push(inst);
  }
  return makeCounterexample(ft, fc, instances, reason, model);
}

function forRing(
  rc: RingConstraint,
  ft: FactType,
  model: OrmModel,
): Counterexample | undefined {
  const r1 = ft.roles.find((r) => r.id === rc.roleId1);
  if (!ft.roles.some((r) => r.id === rc.roleId2) || !r1) return undefined;

  // Both ring roles are played by the same object type; mint from one.
  const a = mintValue(r1, ft, model, 0);
  const b = mintValue(r1, ft, model, 1);
  const c = mintValue(r1, ft, model, 2);
  const pair = (x: string, y: string): RoleValues => {
    const inst: RoleValues = {};
    for (const r of ft.roles) {
      inst[r.id] = r.id === rc.roleId1 ? x : r.id === rc.roleId2 ? y : mintValue(r, ft, model, 0);
    }
    return inst;
  };

  let instances: RoleValues[];
  switch (rc.ringType) {
    case "irreflexive":
      instances = [pair(a, a)];
      break;
    case "asymmetric":
    case "antisymmetric":
    case "acyclic":
      instances = [pair(a, b), pair(b, a)];
      break;
    case "symmetric":
    case "purely_reflexive":
      instances = [pair(a, b)];
      break;
    case "transitive":
      instances = [pair(a, b), pair(b, c)];
      break;
    case "intransitive":
      instances = [pair(a, b), pair(b, c), pair(a, c)];
      break;
    default:
      return undefined;
  }

  const reason = `a ${rc.ringType.replace(/_/g, " ")} ring violation among `
    + `${playerName(r1, model)} instances`;
  return makeCounterexample(ft, rc, instances, reason, model);
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

function makeCounterexample(
  ft: FactType,
  constraint: Constraint,
  instances: readonly RoleValues[],
  reason: string,
  model: OrmModel,
): Counterexample {
  const forbidden = new Population({
    factTypeId: ft.id,
    description: reason,
    instances: instances.map((roleValues) => ({ roleValues })),
  });
  const segments: VerbalizationSegment[] = [
    kwSeg("Rules out: "),
    textSeg(reason),
    textSeg(" -- e.g. "),
    valSeg(renderInstances(instances, ft, model)),
  ];
  return {
    factTypeId: ft.id,
    constraintId: constraint.id,
    constraintType: constraint.type,
    forbidden,
    segments,
    text: segments.map((s) => s.text).join(""),
  };
}

function renderInstances(
  instances: readonly RoleValues[],
  ft: FactType,
  model: OrmModel,
): string {
  return instances
    .map((rv) =>
      "{"
      + ft.roles.map((r) => `${playerName(r, model)}=${rv[r.id] ?? ""}`).join(", ")
      + "}"
    )
    .join("; ");
}
