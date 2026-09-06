import type { RingConstraint, RingProperty, RingType } from "../../../model/Constraint.js";
import { isRing, RING_PROPERTIES } from "../../../model/Constraint.js";
import type { FactType } from "../../../model/FactType.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Population } from "../../../model/Population.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { severityForModality } from "./shared.js";

/**
 * Ring constraints apply to reflexive relationships (a fact type where both
 * roles are played by the same object type). They enforce properties on the
 * directed pairs (roleId1 -> roleId2) in the population.
 *
 * Which properties each ring type is the conjunction of -- and what each
 * property means -- is `RING_PROPERTIES` in `model/Constraint.ts`, which
 * both this rule and the counterexample generator read. This module owns
 * one checker per property and the wording of each finding; it does not
 * restate the algebra (barwise-935).
 *
 * A ring type checks the union of its properties' findings. That is the
 * same set the eight hand-written arms produced, because the conditions
 * within a ring type are disjoint: asymmetric's self-loop case requires
 * a = b and its reverse-pair case requires a != b, so no instance is
 * reported twice. The findings for a population violating one ring
 * constraint in two ways now arrive grouped by property rather than
 * interleaved by instance, which no caller and no golden observes.
 */
export function checkRingViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const ringConstraints = ft.constraints.filter(isRing);
    for (const rc of ringConstraints) {
      diagnostics.push(...ringViolationsIn(pop, ft, rc));
    }
  }

  return diagnostics;
}

/**
 * One ring constraint against ONE population. Shared by the model-wide sweep
 * and the per-constraint entry point, so they cannot answer differently
 * (barwise-904).
 */
function ringViolationsIn(pop: Population, ft: FactType, rc: RingConstraint): Diagnostic[] {
  // Was a `continue` for the model-wide loop; here the constraint simply
  // does not apply to this fact type, so there is nothing to report.
  if (!ft.hasRole(rc.roleId1) || !ft.hasRole(rc.roleId2)) return [];

  const relation = relationOf(pop, rc);
  const severity = severityForModality(rc);
  const word = MESSAGES[rc.ringType];

  const diagnostics: Diagnostic[] = [];
  for (const property of RING_PROPERTIES[rc.ringType]) {
    for (const finding of PROPERTY_CHECKS[property](relation)) {
      diagnostics.push({
        severity,
        message: word(property, finding, pop.id),
        elementId: pop.id,
        ruleId: "population/ring-violation",
      });
    }
  }
  return diagnostics;
}

/**
 * The directed pairs a ring constraint reads, built once per population
 * so the property checkers share one pass over the instances.
 *
 * An instance missing either role value is not a pair: it states no fact
 * about the relation, so no property can be violated by it. (WS1's
 * builder refuses such an instance outright, at which point this filter
 * becomes dead and goes.)
 */
interface RingRelation {
  /** Complete pairs, each with the instance that stated it. */
  readonly stated: ReadonlyArray<
    { readonly instanceId: string; readonly a: string; readonly b: string; }
  >;
  readonly pairs: ReadonlyArray<readonly [string, string]>;
  readonly has: (a: string, b: string) => boolean;
}

function relationOf(pop: Population, rc: RingConstraint): RingRelation {
  const stated: Array<{ instanceId: string; a: string; b: string; }> = [];
  const pairs: Array<[string, string]> = [];
  const seen = new Set<string>();
  for (const inst of pop.instances) {
    const a = inst.roleValues[rc.roleId1];
    const b = inst.roleValues[rc.roleId2];
    if (a === undefined || b === undefined) continue;
    stated.push({ instanceId: inst.id, a, b });
    pairs.push([a, b]);
    seen.add(`${a}\0${b}`);
  }
  return { stated, pairs, has: (a, b) => seen.has(`${a}\0${b}`) };
}

/** One violation, before it is worded. `c` is set only by the composition rules. */
interface RingFinding {
  readonly instanceId?: string;
  readonly a: string;
  readonly b: string;
  readonly c?: string;
}

/**
 * One checker per property. Irreflexive and antisymmetric are each read
 * by two ring types (their own and asymmetric's), which is the whole
 * duplication the eight arms carried.
 */
const PROPERTY_CHECKS: Record<RingProperty, (r: RingRelation) => RingFinding[]> = {
  irreflexive: (r) => r.stated.filter((p) => p.a === p.b),
  antisymmetric: (r) => r.stated.filter((p) => p.a !== p.b && r.has(p.b, p.a)),
  symmetric: (r) => r.stated.filter((p) => !r.has(p.b, p.a)),
  purely_reflexive: (r) => r.stated.filter((p) => p.a !== p.b),
  transitive: (r) => composed(r, (a, c) => !r.has(a, c)),
  intransitive: (r) => composed(r, (a, c) => r.has(a, c)),
  acyclic: (r) => firstCycle(r),
};

/**
 * Every (a, b) and (b, c) in the relation whose composition (a, c)
 * satisfies `reject`. Transitivity and intransitivity are the same walk
 * with opposite verdicts, which is why they share it.
 */
function composed(r: RingRelation, reject: (a: string, c: string) => boolean): RingFinding[] {
  const findings: RingFinding[] = [];
  for (const [a, b] of r.pairs) {
    for (const [b2, c] of r.pairs) {
      if (b === b2 && reject(a, c)) findings.push({ a, b, c });
    }
  }
  return findings;
}

/**
 * The first directed cycle, by depth-first search with three colours.
 *
 * At most one finding, which is the behaviour the hand-written arm had:
 * one cycle names the population as unsound, and enumerating every cycle
 * in a dense population is exponential for no extra information.
 */
function firstCycle(r: RingRelation): RingFinding[] {
  const adj = new Map<string, string[]>();
  for (const [a, b] of r.pairs) {
    const neighbors = adj.get(a);
    if (neighbors) neighbors.push(b);
    else adj.set(a, [b]);
  }

  const state = new Map<string, number>(); // 0 unvisited, 1 in progress, 2 done
  let found: RingFinding | undefined;

  function dfs(node: string): void {
    if (found) return;
    state.set(node, 1);
    for (const neighbor of adj.get(node) ?? []) {
      const s = state.get(neighbor) ?? 0;
      if (s === 1) {
        found = { a: node, b: neighbor };
        return;
      }
      if (s === 0) dfs(neighbor);
      if (found) return;
    }
    state.set(node, 2);
  }

  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0) dfs(node);
    if (found) break;
  }
  return found ? [found] : [];
}

/**
 * How each ring type words a finding. Keyed by ring type rather than by
 * property because that is what the operator reads: a self-loop under an
 * asymmetric constraint says "asymmetric", and says why irreflexivity is
 * implicated. Asymmetric is the only type whose wording depends on which
 * property fired, and the parameter is what lets it say so.
 */
const MESSAGES: Record<RingType, (p: RingProperty, v: RingFinding, popId: string) => string> = {
  irreflexive: (_p, v, popId) =>
    `Population "${popId}": instance "${v.instanceId}" violates `
    + `irreflexive ring constraint -- "${v.a}" appears in both roles.`,

  asymmetric: (p, v, popId) =>
    p === "irreflexive"
      ? `Population "${popId}": instance "${v.instanceId}" violates `
        + `asymmetric ring constraint -- "${v.a}" appears in both `
        + `roles (asymmetric implies irreflexive).`
      : `Population "${popId}": instance "${v.instanceId}" violates `
        + `asymmetric ring constraint -- both (${v.a}, ${v.b}) and `
        + `(${v.b}, ${v.a}) exist.`,

  antisymmetric: (_p, v, popId) =>
    `Population "${popId}": instance "${v.instanceId}" violates `
    + `antisymmetric ring constraint -- both (${v.a}, ${v.b}) and `
    + `(${v.b}, ${v.a}) exist but ${v.a} != ${v.b}.`,

  symmetric: (_p, v, popId) =>
    `Population "${popId}": instance "${v.instanceId}" violates `
    + `symmetric ring constraint -- (${v.a}, ${v.b}) exists but `
    + `(${v.b}, ${v.a}) does not.`,

  intransitive: (_p, v, popId) =>
    `Population "${popId}": intransitive ring constraint `
    + `violated -- (${v.a}, ${v.b}) and (${v.b}, ${v.c}) exist, `
    + `but (${v.a}, ${v.c}) also exists.`,

  transitive: (_p, v, popId) =>
    `Population "${popId}": transitive ring constraint `
    + `violated -- (${v.a}, ${v.b}) and (${v.b}, ${v.c}) exist, `
    + `but (${v.a}, ${v.c}) does not.`,

  acyclic: (_p, v, popId) =>
    `Population "${popId}": acyclic ring constraint violated -- `
    + `cycle detected involving "${v.a}" and "${v.b}".`,

  purely_reflexive: (_p, v, popId) =>
    `Population "${popId}": instance "${v.instanceId}" violates `
    + `purely reflexive ring constraint -- (${v.a}, ${v.b}) exists `
    + `but only self-loops (a, a) are allowed.`,
};

/** Does this one ring constraint reject the model's population? */
export function ringViolationsFor(
  model: OrmModel,
  factTypeId: string,
  rc: RingConstraint,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const pop of model.populations) {
    if (pop.factTypeId !== factTypeId) continue;
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;
    diagnostics.push(...ringViolationsIn(pop, ft, rc));
  }
  return diagnostics;
}
