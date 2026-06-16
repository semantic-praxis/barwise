import { isRing } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";

/**
 * Ring constraints apply to reflexive relationships (a fact type where both
 * roles are played by the same object type). They enforce properties on the
 * directed pairs (roleId1 -> roleId2) in the population.
 *
 * Ring types and their semantics:
 *
 * - irreflexive: No self-loops. (a, a) is forbidden.
 *     Example: "No Person is a parent of that same Person."
 *
 * - asymmetric: If (a, b) then NOT (b, a). Implies irreflexive.
 *     Example: "If Person1 is parent of Person2, then Person2 is not
 *     parent of Person1."
 *
 * - antisymmetric: If (a, b) AND (b, a) then a = b.
 *     Example: "If Person1 manages Person2 and Person2 manages Person1,
 *     then they are the same Person."
 *
 * - symmetric: If (a, b) then (b, a) must also exist.
 *     Example: "If Person1 is sibling of Person2, then Person2 is
 *     sibling of Person1."
 *
 * - intransitive: If (a, b) AND (b, c) then NOT (a, c).
 *     Example: "If Person1 is parent of Person2 and Person2 is parent
 *     of Person3, then Person1 is not parent of Person3."
 *
 * - transitive: If (a, b) AND (b, c) then (a, c) must exist.
 *     Example: "If Person1 is ancestor of Person2 and Person2 is
 *     ancestor of Person3, then Person1 is ancestor of Person3."
 *
 * - acyclic: No directed cycles of any length. (a -> b -> ... -> a) is
 *     forbidden.
 *     Example: "No Person can be their own ancestor through any chain
 *     of parent relationships."
 *
 * - purely_reflexive: Only self-loops allowed. If (a, b) then a = b.
 *     Example: "A Person can only be compared to themselves."
 */
export function checkRingViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const ringConstraints = ft.constraints.filter(isRing);
    for (const rc of ringConstraints) {
      if (!ft.hasRole(rc.roleId1) || !ft.hasRole(rc.roleId2)) continue;

      // Build the set of directed pairs.
      const pairs: Array<[string, string]> = [];
      const pairSet = new Set<string>();
      for (const inst of pop.instances) {
        const a = inst.roleValues[rc.roleId1];
        const b = inst.roleValues[rc.roleId2];
        if (a !== undefined && b !== undefined) {
          pairs.push([a, b]);
          pairSet.add(`${a}\0${b}`);
        }
      }

      switch (rc.ringType) {
        case "irreflexive":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && a === b) {
              diagnostics.push({
                severity: "error",
                message: `Population "${pop.id}": instance "${inst.id}" violates `
                  + `irreflexive ring constraint -- "${a}" appears in both roles.`,
                elementId: pop.id,
                ruleId: "population/ring-violation",
              });
            }
          }
          break;

        case "asymmetric":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && b !== undefined) {
              if (a === b) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": instance "${inst.id}" violates `
                    + `asymmetric ring constraint -- "${a}" appears in both `
                    + `roles (asymmetric implies irreflexive).`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              } else if (pairSet.has(`${b}\0${a}`)) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": instance "${inst.id}" violates `
                    + `asymmetric ring constraint -- both (${a}, ${b}) and `
                    + `(${b}, ${a}) exist.`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              }
            }
          }
          break;

        case "antisymmetric":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && b !== undefined && a !== b) {
              if (pairSet.has(`${b}\0${a}`)) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": instance "${inst.id}" violates `
                    + `antisymmetric ring constraint -- both (${a}, ${b}) and `
                    + `(${b}, ${a}) exist but ${a} != ${b}.`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              }
            }
          }
          break;

        case "symmetric":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && b !== undefined && !pairSet.has(`${b}\0${a}`)) {
              diagnostics.push({
                severity: "error",
                message: `Population "${pop.id}": instance "${inst.id}" violates `
                  + `symmetric ring constraint -- (${a}, ${b}) exists but `
                  + `(${b}, ${a}) does not.`,
                elementId: pop.id,
                ruleId: "population/ring-violation",
              });
            }
          }
          break;

        case "intransitive":
          for (const [a, b] of pairs) {
            // Find all (b, c) pairs and check (a, c) does not exist.
            for (const [b2, c] of pairs) {
              if (b === b2 && pairSet.has(`${a}\0${c}`)) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": intransitive ring constraint `
                    + `violated -- (${a}, ${b}) and (${b}, ${c}) exist, `
                    + `but (${a}, ${c}) also exists.`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              }
            }
          }
          break;

        case "transitive":
          for (const [a, b] of pairs) {
            for (const [b2, c] of pairs) {
              if (b === b2 && !pairSet.has(`${a}\0${c}`)) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": transitive ring constraint `
                    + `violated -- (${a}, ${b}) and (${b}, ${c}) exist, `
                    + `but (${a}, ${c}) does not.`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              }
            }
          }
          break;

        case "acyclic":
          diagnostics.push(...checkAcyclic(pairs, pop.id));
          break;

        case "purely_reflexive":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && b !== undefined && a !== b) {
              diagnostics.push({
                severity: "error",
                message: `Population "${pop.id}": instance "${inst.id}" violates `
                  + `purely reflexive ring constraint -- (${a}, ${b}) exists `
                  + `but only self-loops (a, a) are allowed.`,
                elementId: pop.id,
                ruleId: "population/ring-violation",
              });
            }
          }
          break;
      }
    }
  }

  return diagnostics;
}

/**
 * Check for cycles in a directed graph represented as edge pairs.
 * Uses DFS with coloring (white/gray/black) for cycle detection.
 */
function checkAcyclic(
  pairs: Array<[string, string]>,
  popId: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Build adjacency list.
  const adj = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    const neighbors = adj.get(a);
    if (neighbors) {
      neighbors.push(b);
    } else {
      adj.set(a, [b]);
    }
  }

  // DFS with 3 states: 0 = unvisited, 1 = in progress, 2 = done.
  const state = new Map<string, number>();
  let cycleFound = false;

  function dfs(node: string): void {
    if (cycleFound) return;
    state.set(node, 1); // in progress
    for (const neighbor of adj.get(node) ?? []) {
      const s = state.get(neighbor) ?? 0;
      if (s === 1) {
        // Back edge: cycle detected.
        cycleFound = true;
        diagnostics.push({
          severity: "error",
          message: `Population "${popId}": acyclic ring constraint violated -- `
            + `cycle detected involving "${node}" and "${neighbor}".`,
          elementId: popId,
          ruleId: "population/ring-violation",
        });
        return;
      }
      if (s === 0) {
        dfs(neighbor);
      }
    }
    state.set(node, 2); // done
  }

  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      dfs(node);
      if (cycleFound) break;
    }
  }

  return diagnostics;
}
