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

export function serializeFactType(ft: FactType): OrmYamlFactType {
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

  if (ft.constraints.length > 0) {
    result.constraints = ft.constraints.map((c) => serializeConstraint(c));
  }
  if (ft.derivation) {
    result.derivation = serializeDerivation(ft.derivation);
  }

  return result;
}

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
    constraints: (ftDoc.constraints ?? []).map((c) => deserializeConstraint(c)),
    derivation: ftDoc.derivation ? deserializeDerivation(ftDoc.derivation) : undefined,
  };
}
