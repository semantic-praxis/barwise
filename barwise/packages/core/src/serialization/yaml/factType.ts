import type { ExternalConstraint } from "../../model/Constraint.js";
import type { FactType, FactTypeConfig } from "../../model/FactType.js";
import type { Role } from "../../model/Role.js";
import {
  deserializeConstraint,
  type OrmYamlConstraint,
  serializeConstraint,
} from "./constraint.js";
import {
  deserializeDerivation,
  type OrmYamlDerivation,
  serializeDerivation,
} from "./derivation.js";

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
 * @param across The constraints across fact types this fact type carries in
 *   a 2.0 file, written after its own: the model holds them, and 2.0 nests
 *   each under one fact type (`lowerConstraints`).
 */
export function serializeFactType(
  ft: FactType,
  across: readonly ExternalConstraint[] = [],
): OrmYamlFactType {
  const result: OrmYamlFactType = {
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

  const constraints = [...ft.internalConstraints, ...across];
  if (constraints.length > 0) {
    result.constraints = constraints.map((c) => serializeConstraint(c));
  }
  if (ft.derivation) {
    result.derivation = serializeDerivation(ft.derivation);
  }

  return result;
}

/**
 * A constraint the file leaves without an id comes back without one; the
 * model loader derives it (`withDerivedIds`), since constraint ids are
 * model-wide and one fact type cannot see the others' stated ids.
 */
export function deserializeFactType(ftDoc: OrmYamlFactType): FactTypeConfig {
  return {
    id: ftDoc.id,
    name: ftDoc.name,
    definition: ftDoc.definition,
    note: ftDoc.note,
    roles: ftDoc.roles.map((r) => ({
      id: r.id,
      name: r.role_name,
      playerId: r.player,
    })),
    readings: ftDoc.readings,
    constraints: (ftDoc.constraints ?? []).map(deserializeConstraint),
    derivation: ftDoc.derivation ? deserializeDerivation(ftDoc.derivation) : undefined,
  };
}
