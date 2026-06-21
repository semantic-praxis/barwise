import {
  isJoinEquality,
  isJoinExclusion,
  isJoinSubset,
  type RolePath,
} from "../../../model/Constraint.js";
import type { FactType } from "../../../model/FactType.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { buildObjectUniverse, severityForModality } from "./shared.js";

/**
 * Join-constraint population satisfaction.
 *
 * For each operand role path, compute -- correlated by the shared root (join
 * variable) -- the set of endpoint values each root value reaches by
 * following the declared hops over the sample population. Then check the
 * relation: subset containment, equality of endpoint sets, or pairwise
 * disjointness. A closed-world reading of the sample, as the other
 * population rules use: a root that reaches nothing via one path is treated
 * as the empty set, so an equality/subset against a non-empty path fails.
 *
 * Pure over the population. Malformed paths (flagged structurally elsewhere)
 * are skipped here.
 */
export function checkJoinPathViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      const elementId = c.id ?? ft.id;
      const severity = severityForModality(c);

      if (isJoinSubset(c)) {
        const sub = reach(model, c.subset);
        const sup = reach(model, c.superset);
        const bad = firstRootWhere([...sub.keys()], (v) => {
          const supSet = sup.get(v) ?? EMPTY;
          for (const e of sub.get(v) ?? EMPTY) {
            if (!supSet.has(e)) return true;
          }
          return false;
        });
        if (bad !== undefined) {
          diagnostics.push({
            severity,
            message: `Join subset constraint in fact type "${ft.name}" is violated: `
              + `for root "${bad}", an endpoint of the subset path is not reached by `
              + `the superset path.`,
            elementId,
            ruleId: "population/join-subset-violation",
          });
        }
      } else if (isJoinEquality(c)) {
        const reaches = c.paths.map((p) => reach(model, p));
        const bad = firstRootWhere(rootKeys(reaches), (v) => {
          const sets = reaches.map((r) => r.get(v) ?? EMPTY);
          return !allSetsEqual(sets);
        });
        if (bad !== undefined) {
          diagnostics.push({
            severity,
            message: `Join equality constraint in fact type "${ft.name}" is violated: `
              + `root "${bad}" reaches different endpoint sets across the paths.`,
            elementId,
            ruleId: "population/join-equality-violation",
          });
        }
      } else if (isJoinExclusion(c)) {
        const reaches = c.paths.map((p) => reach(model, p));
        const bad = firstRootWhere(rootKeys(reaches), (v) => {
          const counts = new Map<string, number>();
          for (const r of reaches) {
            for (const e of r.get(v) ?? EMPTY) {
              counts.set(e, (counts.get(e) ?? 0) + 1);
            }
          }
          for (const n of counts.values()) {
            if (n > 1) return true;
          }
          return false;
        });
        if (bad !== undefined) {
          diagnostics.push({
            severity,
            message: `Join exclusion constraint in fact type "${ft.name}" is violated: `
              + `for root "${bad}", an endpoint is reached by more than one path.`,
            elementId,
            ruleId: "population/join-exclusion-violation",
          });
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
 * Map each root value to the set of endpoint values it reaches by following
 * the path's hops over the population. Root values come from the root type's
 * object universe; an unresolvable step yields an empty map (malformed).
 */
function reach(model: OrmModel, path: RolePath): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const rootValues = buildObjectUniverse(model).get(path.root) ?? EMPTY;
  for (const v of rootValues) result.set(v, new Set([v]));

  for (const step of path.steps) {
    const ft = factTypeOfRole(model, step.entry);
    if (!ft) return new Map();

    // entryValue -> set of exitValues across this fact type's populations.
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

    for (const [rootV, current] of result) {
      const next = new Set<string>();
      for (const x of current) {
        for (const o of adjacency.get(x) ?? EMPTY) next.add(o);
      }
      result.set(rootV, next);
    }
  }

  return result;
}

/** The union of root keys across several reach maps. */
function rootKeys(reaches: Map<string, Set<string>>[]): string[] {
  const keys = new Set<string>();
  for (const r of reaches) {
    for (const k of r.keys()) keys.add(k);
  }
  return [...keys];
}

function firstRootWhere(roots: string[], predicate: (v: string) => boolean): string | undefined {
  for (const v of roots) {
    if (predicate(v)) return v;
  }
  return undefined;
}

function allSetsEqual(sets: ReadonlySet<string>[]): boolean {
  const first = sets[0];
  if (!first) return true;
  for (const s of sets) {
    if (s.size !== first.size) return false;
    for (const e of first) {
      if (!s.has(e)) return false;
    }
  }
  return true;
}
