/**
 * Sample-population mapping: flatten NORMA's instance graph into per-fact
 * populations of role-id -> value maps.
 *
 * NORMA encodes populations as a graph: ValueTypeInstance elements carry
 * atomic values, EntityTypeInstance elements are identified by refs to
 * role-instance declarations on their identifying fact's roles, and
 * FactTypeInstance elements reference role-instance declarations for the
 * populated fact's roles. Each declaration (on the Role element) pairs a
 * role with one object-type instance. This pass resolves the refs down to
 * value strings; barwise's flat Population is the deliberate shape the
 * validators consume.
 */
import type { FactInstanceConfig } from "@barwise/core";
import type { NormaMappingContext } from "./context.js";

/** Flatten NORMA instance collections into model populations (phase 4). */
export function mapPopulations(ctx: NormaMappingContext): void {
  const { doc, model, roleIdMap, factTypeIdMap } = ctx;

  // Role-instance declarations across every fact's roles: decl id ->
  // (role, object instance).
  const declById = new Map<string, { roleId: string; objectInstanceRef: string; }>();
  for (const nft of doc.factTypes) {
    for (const role of nft.roles) {
      for (const decl of role.roleInstances ?? []) {
        declById.set(decl.id, {
          roleId: role.id,
          objectInstanceRef: decl.objectInstanceRef,
        });
      }
    }
  }

  // Atomic values.
  const valueByInstanceId = new Map<string, string>();
  for (const vt of doc.valueTypes) {
    for (const inst of vt.instances ?? []) {
      valueByInstanceId.set(inst.id, inst.value);
    }
  }

  // Entity instances resolve to their identifying value: the first
  // identifying role instance whose object instance is a value.
  for (const et of doc.entityTypes) {
    for (const inst of et.instances ?? []) {
      for (const ref of inst.roleInstanceRefs) {
        const decl = declById.get(ref);
        const value = decl ? valueByInstanceId.get(decl.objectInstanceRef) : undefined;
        if (value !== undefined) {
          valueByInstanceId.set(inst.id, value);
          break;
        }
      }
    }
  }

  for (const nft of doc.factTypes) {
    const normaInstances = nft.instances ?? [];
    if (normaInstances.length === 0) continue;
    const factTypeId = factTypeIdMap.get(nft.id);
    if (!factTypeId) continue;

    const instances: FactInstanceConfig[] = [];
    for (const fi of normaInstances) {
      const roleValues: Record<string, string> = {};
      for (const ref of fi.roleInstanceRefs) {
        const decl = declById.get(ref);
        if (!decl) continue;
        const value = valueByInstanceId.get(decl.objectInstanceRef);
        if (value === undefined) continue;
        roleValues[roleIdMap.get(decl.roleId) ?? decl.roleId] = value;
      }
      if (Object.keys(roleValues).length > 0) {
        instances.push({ roleValues });
      }
    }
    if (instances.length > 0) {
      model.addPopulation({ factTypeId, instances });
    }
  }
}
