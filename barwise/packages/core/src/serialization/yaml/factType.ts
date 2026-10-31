import type { FactType } from "../../model/FactType.js";
import type { Role } from "../../model/Role.js";
import type { OrmYamlConstraint } from "./constraint.js";
import { type OrmYamlDerivation, serializeDerivation } from "./derivation.js";

export interface OrmYamlRole {
  id: string;
  player: string;
  role_name: string;
}

export interface OrmYamlFactType {
  id: string;
  name: string;
  definition?: string;
  note?: string;
  roles: OrmYamlRole[];
  readings: string[];
  constraints?: OrmYamlConstraint[];
  derivation?: OrmYamlDerivation;
}

function serializeRole(role: Role): OrmYamlRole {
  return {
    id: role.id,
    player: role.playerId,
    role_name: role.name,
  };
}

/**
 * A fact type with its own constraints, the internal kinds. The model's
 * constraints across fact types are written to `model.constraints` by
 * `writeDocument`, not here (format 3.0). Each constraint is written by
 * the format's own writer, whose return type types the list.
 */
export function serializeFactType<C extends OrmYamlConstraint>(
  ft: FactType,
  constraint: (c: FactType["internalConstraints"][number]) => C,
): Omit<OrmYamlFactType, "constraints"> & { constraints?: C[]; } {
  const result: Omit<OrmYamlFactType, "constraints"> & { constraints?: C[]; } = {
    id: ft.id,
    name: ft.name,
    roles: ft.roles.map((r) => serializeRole(r)),
    readings: ft.readings.map((ro) => ro.template),
  };

  if (ft.definition) {
    result.definition = ft.definition;
  }
  if (ft.note) {
    result.note = ft.note;
  }

  if (ft.internalConstraints.length > 0) {
    result.constraints = ft.internalConstraints.map((c) => constraint(c));
  }
  if (ft.derivation) {
    result.derivation = serializeDerivation(ft.derivation);
  }

  return result;
}
