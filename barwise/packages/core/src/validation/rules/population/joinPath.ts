import {
  isJoinEquality,
  isJoinExclusion,
  isJoinSubset,
  type JoinOperand,
} from "../../../model/Constraint.js";
import type { FactType } from "../../../model/FactType.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { reportAs, RULE_ID } from "../../ruleId.js";
import { buildObjectUniverse, severityForModality } from "./shared.js";

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
export function checkJoinPathViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      const elementId = c.id ?? ft.id;
      const severity = severityForModality(c);

      if (isJoinSubset(c)) {
        const sub = projectedTuples(model, c.subset);
        const sup = projectedTuples(model, c.superset);
        const missing = [...sub].find((t) => !sup.has(t));
        if (missing !== undefined) {
          diagnostics.push(
            reportAs(severity, RULE_ID.joinSubsetViolation, "default", elementId, ft.name, missing),
          );
        }
      } else if (isJoinEquality(c)) {
        const sets = c.operands.map((o) => projectedTuples(model, o));
        const all = new Set<string>(sets.flatMap((s) => [...s]));
        const bad = [...all].find((t) => sets.some((s) => !s.has(t)));
        if (bad !== undefined) {
          diagnostics.push(
            reportAs(severity, RULE_ID.joinEqualityViolation, "default", elementId, ft.name, bad),
          );
        }
      } else if (isJoinExclusion(c)) {
        const sets = c.operands.map((o) => projectedTuples(model, o));
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
              ft.name,
              shared,
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}

const EMPTY: ReadonlySet<string> = new Set();

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
function projectedTuples(model: OrmModel, operand: JoinOperand): Set<string> {
  const { path, projection } = operand;

  let bindings: string[][] = [];
  for (const v of buildObjectUniverse(model).get(path.root) ?? EMPTY) {
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
