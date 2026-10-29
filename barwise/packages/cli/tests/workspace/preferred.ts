/**
 * Each entity's resolved preferred identifier, without ids, for the parity
 * tests that compare the DDL and dbt importers (barwise-fuo): the
 * entity's name, the constraint's kind, and per role its fact type's
 * players and its own player, sorted, since the two importers order fact
 * types and roles differently.
 */
import { type OrmModel, preferredIdentifiers } from "@barwise/core";

export function describePreferred(model: OrmModel): string[] {
  const name = (id: string) => model.getObjectType(id)?.name ?? "?";
  const out: string[] = [];
  for (const [entityId, at] of preferredIdentifiers(model).byEntity) {
    const roles = at.constraint.roleIds.map((roleId) => {
      const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === roleId));
      const role = ft?.roles.find((r) => r.id === roleId);
      return ft && role
        ? `${ft.roles.map((r) => name(r.playerId)).join("/")}:${name(role.playerId)}`
        : "?";
    }).sort();
    out.push(`${name(entityId)}: ${at.constraint.type} ${roles.join(", ")}`);
  }
  return out.sort();
}
