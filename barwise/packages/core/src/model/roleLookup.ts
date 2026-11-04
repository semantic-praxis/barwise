/**
 * A role and the fact type holding it, the given fact type first and then
 * the model's own lookup (`factTypesHolding`). Internal to core: the
 * ConstraintSpec builder labels roles with it, and the constraint router
 * finds a role's column with it, so the two resolve a role the same way.
 */
import type { FactType } from "./FactType.js";
import type { OrmModel } from "./OrmModel.js";

export function findRole(
  roleId: string,
  preferred: FactType | undefined,
  model: OrmModel,
): { factType: FactType; role: FactType["roles"][number]; } | undefined {
  const factType = preferred?.getRoleById(roleId) ? preferred : model.factTypesHolding([roleId])[0];
  const role = factType?.getRoleById(roleId);
  return factType && role ? { factType, role } : undefined;
}
