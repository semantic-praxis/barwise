import type { OrmModel } from "@barwise/core";
import type { ElementQuery } from "../../exercise/types.js";
import type { CheckResult } from "../GymReport.js";
import { getObjectTypeByNameOrAlias } from "../nameResolution.js";

/**
 * Is there a fact type in the model with a role played by an object type
 * named (or aliased) `a` and a (distinct) role played by one named `b`?
 */
function hasFactTypeBetween(model: OrmModel, a: string, b: string): boolean {
  const otA = getObjectTypeByNameOrAlias(model, a);
  const otB = getObjectTypeByNameOrAlias(model, b);
  if (!otA || !otB) return false;

  return model.factTypes.some((ft) => {
    const idxA = ft.roles.findIndex((r) => r.playerId === otA.id);
    const idxB = ft.roles.findIndex((r) => r.playerId === otB.id && r.id !== ft.roles[idxA]?.id);
    return idxA >= 0 && idxB >= 0;
  });
}

/**
 * Pass iff the candidate satisfies a structural precondition: a named
 * object type exists, or a fact type connects two named object types.
 */
export function requiresElement(
  candidate: OrmModel,
  element: ElementQuery,
  hint?: string,
): CheckResult {
  if ("entity" in element) {
    const found = getObjectTypeByNameOrAlias(candidate, element.entity) !== undefined;
    return {
      kind: "requires_element",
      passed: found,
      message: found
        ? `The model has an object type "${element.entity}".`
        : `The model has no object type named "${element.entity}".`,
      hint: found ? undefined : hint,
    };
  }

  const [a, b] = element.factTypeBetween;
  const found = hasFactTypeBetween(candidate, a, b);
  return {
    kind: "requires_element",
    passed: found,
    message: found
      ? `The model has a fact type between "${a}" and "${b}".`
      : `The model has no fact type connecting "${a}" and "${b}".`,
    hint: found ? undefined : hint,
  };
}
