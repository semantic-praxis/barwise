import {
  isJoinEquality,
  isJoinExclusion,
  isJoinRing,
  isJoinSubset,
  type JoinOperand,
} from "../../../model/Constraint.js";
import type { FactType } from "../../../model/FactType.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { reportAs, RULE_ID } from "../../ruleId.js";
import { constraintElementId, constraintSpan } from "../../span.js";
import { joinRingViolationTexts } from "./ring.js";
import { type ObjectUniverse, severityForModality } from "./shared.js";

/**
 * Join-constraint population satisfaction.
 *
 * For each operand, expand its role path over the sample population into a
 * set of bindings (a value per path node), project the operand's projection
 * nodes into a tuple, and collect the tuple set. Then check the relation:
 * subset containment, equality, or pairwise disjointness of the tuple sets.
 * A closed-world reading of the sample, as the other population rules use.
 *
 * Pure over the population. Malformed paths (flagged structurally elsewhere)
 * yield empty tuple sets and are skipped.
 */
export function checkJoinPathViolations(model: OrmModel, universe: ObjectUniverse): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const c of model.constraints) {
    if (!isJoinSubset(c) && !isJoinEquality(c) && !isJoinExclusion(c) && !isJoinRing(c)) {
      continue;
    }
    const elementId = constraintElementId(c);
    const span = constraintSpan(model, c);
    const severity = severityForModality(c);

    if (isJoinRing(c)) {
      // A projection that is not two distinct nodes of one type is a
      // structural error (`constraint/join-ring-arity`,
      // `-different-players`); its tuples are no ring's pairs.
      const [from, to] = c.operand.projection;
      if (c.operand.projection.length !== 2 || from === to) continue;
      if (nodeType(model, c.operand, from!) !== nodeType(model, c.operand, to!)) continue;
      // A ring reads data PRESENT, so samples count, as the flat ring's
      // populations do: start from every value the first hop's entry role
      // plays, not from the universe, which leaves samples out.
      const pairs = [...projectedTuples(model, entryRoots(model, c.operand), c.operand)].map(
        (t) => JSON.parse(t) as [string, string],
      );
      for (const text of joinRingViolationTexts(c.ringType, pairs, span)) {
        diagnostics.push(reportAs(severity, RULE_ID.joinRingViolation, "default", elementId, text));
      }
    } else if (isJoinSubset(c)) {
      const sub = projectedTuples(model, universe, c.subset);
      const sup = projectedTuples(model, universe, c.superset);
      const missing = [...sub].find((t) => !sup.has(t));
      if (missing !== undefined) {
        diagnostics.push(
          reportAs(severity, RULE_ID.joinSubsetViolation, "default", elementId, span, missing),
        );
      }
    } else if (isJoinEquality(c)) {
      const sets = c.operands.map((o) => projectedTuples(model, universe, o));
      const all = new Set<string>(sets.flatMap((s) => [...s]));
      const bad = [...all].find((t) => sets.some((s) => !s.has(t)));
      if (bad !== undefined) {
        diagnostics.push(
          reportAs(severity, RULE_ID.joinEqualityViolation, "default", elementId, span, bad),
        );
      }
    } else if (isJoinExclusion(c)) {
      const sets = c.operands.map((o) => projectedTuples(model, universe, o));
      const counts = new Map<string, number>();
      for (const s of sets) {
        for (const t of s) counts.set(t, (counts.get(t) ?? 0) + 1);
      }
      const shared = [...counts].find(([, n]) => n > 1)?.[0];
      if (shared !== undefined) {
        diagnostics.push(
          reportAs(
            severity,
            RULE_ID.joinExclusionViolation,
            "default",
            elementId,
            span,
            shared,
          ),
        );
      }
    }
  }

  return diagnostics;
}

const EMPTY: ReadonlySet<string> = new Set();

/** The object type at path node `index`: the root, or the player after step `index`. */
function nodeType(model: OrmModel, operand: JoinOperand, index: number): string | undefined {
  if (index === 0) return operand.path.root;
  const step = operand.path.steps[index - 1];
  return step && factTypeOfRole(model, step.entry)?.getRoleById(step.exit)?.playerId;
}

/**
 * A universe holding, for the path root, every value the first hop's entry
 * role plays in any population, samples included. A binding that does not
 * play that role ends at the first hop, so nothing else could be a root.
 */
function entryRoots(model: OrmModel, operand: JoinOperand): ObjectUniverse {
  const first = operand.path.steps[0];
  const values = new Set<string>();
  if (first) {
    for (const pop of model.populations) {
      for (const inst of pop.instances) {
        const v = inst.roleValues[first.entry];
        if (v !== undefined) values.add(v);
      }
    }
  }
  return new Map([[operand.path.root, values]]);
}

/** The fact type owning a role id, scanning the model. */
function factTypeOfRole(model: OrmModel, roleId: string): FactType | undefined {
  for (const ft of model.factTypes) {
    if (ft.getRoleById(roleId)) return ft;
  }
  return undefined;
}

/**
 * Expand an operand's path over the population into bindings (a value per
 * node), then project each binding's projected nodes into a tuple key. The
 * returned set is the operand's projected tuple set. An unresolvable step
 * yields the empty set (malformed path).
 */
function projectedTuples(
  model: OrmModel,
  universe: ObjectUniverse,
  operand: JoinOperand,
): Set<string> {
  const { path, projection } = operand;

  let bindings: string[][] = [];
  for (const v of universe.get(path.root) ?? EMPTY) {
    bindings.push([v]);
  }

  for (const step of path.steps) {
    const ft = factTypeOfRole(model, step.entry);
    if (!ft) return new Set();

    const adjacency = new Map<string, Set<string>>();
    for (const pop of model.populations) {
      if (pop.factTypeId !== ft.id) continue;
      for (const inst of pop.instances) {
        const ev = inst.roleValues[step.entry];
        const xv = inst.roleValues[step.exit];
        if (ev === undefined || xv === undefined) continue;
        let outs = adjacency.get(ev);
        if (!outs) {
          outs = new Set();
          adjacency.set(ev, outs);
        }
        outs.add(xv);
      }
    }

    const next: string[][] = [];
    for (const b of bindings) {
      const current = b[b.length - 1]!;
      for (const y of adjacency.get(current) ?? EMPTY) next.push([...b, y]);
    }
    bindings = next;
  }

  const tuples = new Set<string>();
  for (const b of bindings) {
    if (projection.some((i) => i >= b.length)) continue;
    tuples.add(JSON.stringify(projection.map((i) => b[i])));
  }
  return tuples;
}
