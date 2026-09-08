import { identificationOrder } from "../../model/identification.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";
import { report, RULE_ID } from "../ruleId.js";

/**
 * Structural validation rules.
 *
 * These check the basic well-formedness of the model:
 * - Every role in every fact type references an object type that exists.
 * - No duplicate object type names.
 * - No duplicate fact type names.
 * - Binary fact types have at least two readings (forward and inverse).
 * - Subtype facts reference existing entity types.
 * - Subtype hierarchy has no cycles.
 * - Objectified fact types reference existing fact types and entity types.
 * - No duplicate objectification of the same fact type.
 */
export function structuralRules(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkDanglingRoleReferences(model));
  diagnostics.push(...checkDuplicateObjectTypeNames(model));
  diagnostics.push(...checkDuplicateFactTypeNames(model));
  diagnostics.push(...checkBinaryFactTypeReadings(model));
  diagnostics.push(...checkSubtypeFactReferences(model));
  diagnostics.push(...checkSubtypeCycles(model));
  diagnostics.push(...checkObjectifiedFactTypeReferences(model));
  diagnostics.push(...checkIdentificationCycles(model));

  return diagnostics;
}

/**
 * Every role's playerId must reference an object type that exists
 * in the model.
 */
function checkDanglingRoleReferences(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      if (!model.getObjectType(role.playerId)) {
        diagnostics.push(
          report(
            RULE_ID.danglingRoleReference,
            "default",
            ft.id,
            role.name,
            ft.name,
            role.playerId,
          ),
        );
      }
    }
  }

  return diagnostics;
}

/**
 * No two object types should share the same name.
 *
 * The OrmModel.addObjectType method already prevents this at construction
 * time, but models loaded from files could have slipped through.
 */
function checkDuplicateObjectTypeNames(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, string>(); // name -> first id

  for (const ot of model.objectTypes) {
    const existing = seen.get(ot.name);
    if (existing) {
      diagnostics.push(
        report(RULE_ID.duplicateObjectTypeName, "default", ot.id, ot.name, existing),
      );
    } else {
      seen.set(ot.name, ot.id);
    }
  }

  return diagnostics;
}

/**
 * No two fact types should share the same name.
 */
function checkDuplicateFactTypeNames(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, string>();

  for (const ft of model.factTypes) {
    const existing = seen.get(ft.name);
    if (existing) {
      diagnostics.push(report(RULE_ID.duplicateFactTypeName, "default", ft.id, ft.name, existing));
    } else {
      seen.set(ft.name, ft.id);
    }
  }

  return diagnostics;
}

/**
 * Binary fact types should have at least two readings (forward and inverse).
 * This is a warning, not an error -- a single reading is technically valid
 * but usually indicates the modeler forgot the inverse.
 */
function checkBinaryFactTypeReadings(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    if (ft.arity === 2 && ft.readings.length < 2) {
      diagnostics.push(
        report(RULE_ID.binaryMissingInverseReading, "default", ft.id, ft.name, ft.readings.length),
      );
    }
  }

  return diagnostics;
}

/**
 * Subtype facts must reference existing entity types for both the
 * subtype and supertype sides.
 */
function checkSubtypeFactReferences(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const sf of model.subtypeFacts) {
    const subtype = model.getObjectType(sf.subtypeId);
    if (!subtype) {
      diagnostics.push(report(RULE_ID.subtypeDanglingSubtype, "default", sf.id, sf.subtypeId));
    } else if (subtype.kind !== "entity") {
      diagnostics.push(
        report(RULE_ID.subtypeNotEntity, "subtypeSide", sf.id, subtype.name, subtype.kind),
      );
    }

    const supertype = model.getObjectType(sf.supertypeId);
    if (!supertype) {
      diagnostics.push(report(RULE_ID.subtypeDanglingSupertype, "default", sf.id, sf.supertypeId));
    } else if (supertype.kind !== "entity") {
      diagnostics.push(
        report(RULE_ID.subtypeNotEntity, "supertypeSide", sf.id, supertype.name, supertype.kind),
      );
    }
  }

  return diagnostics;
}

/**
 * The subtype hierarchy must not contain cycles.
 * A cycle means A is a subtype of B, B is a subtype of C, and C is a
 * subtype of A -- which is logically impossible.
 */
function checkSubtypeCycles(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Build adjacency list: subtypeId -> supertypeIds.
  const edges = new Map<string, string[]>();
  for (const sf of model.subtypeFacts) {
    const existing = edges.get(sf.subtypeId);
    if (existing) {
      existing.push(sf.supertypeId);
    } else {
      edges.set(sf.subtypeId, [sf.supertypeId]);
    }
  }

  // DFS cycle detection.
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(nodeId: string): boolean {
    if (inStack.has(nodeId)) return true; // cycle
    if (visited.has(nodeId)) return false;

    visited.add(nodeId);
    inStack.add(nodeId);

    for (const supertypeId of edges.get(nodeId) ?? []) {
      if (dfs(supertypeId)) return true;
    }

    inStack.delete(nodeId);
    return false;
  }

  for (const nodeId of edges.keys()) {
    if (!visited.has(nodeId) && dfs(nodeId)) {
      diagnostics.push(report(RULE_ID.subtypeCycle, "default", nodeId));
      break; // Report once, not per node.
    }
  }

  return diagnostics;
}

/**
 * No object type may be identified, directly or transitively, by itself.
 *
 * Broader than `checkSubtypeCycles` above, and for a different reason.
 * That rule asks whether a type is its own ancestor; this asks whether a
 * type's KEY depends on its own, which an objectification creates as
 * readily as a subtype fact does. The two edges are defined once in
 * `identificationGraph`, which the relational mapper also reads to order
 * key settlement -- so a model this rule accepts is one the mapper can
 * settle, and that is the point of the rule rather than a side effect.
 *
 * The length-one case is an object type objectifying a fact type it
 * plays a role in (barwise-962). The mapper carried a defensive skip for
 * exactly that shape and could not see the longer ones.
 */
function checkIdentificationCycles(model: OrmModel): Diagnostic[] {
  const result = identificationOrder(model);
  if (!("cycle" in result)) return [];

  const names = result.cycle.map((id) => model.getObjectType(id)?.name ?? id);
  return [
    report(RULE_ID.identificationCycle, "default", result.cycle[0]!, names.join(" -> ")),
  ];
}

/**
 * Objectified fact types must reference existing fact types and entity types.
 * Also checks for duplicate objectification (one fact type can only be
 * objectified once, and one entity type can only serve as one objectification).
 */
function checkObjectifiedFactTypeReferences(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seenFactTypes = new Set<string>();
  const seenObjectTypes = new Set<string>();

  for (const oft of model.objectifiedFactTypes) {
    // Check that the fact type exists.
    const factType = model.getFactType(oft.factTypeId);
    if (!factType) {
      diagnostics.push(
        report(RULE_ID.objectifiedDanglingFactType, "default", oft.id, oft.factTypeId),
      );
    }

    // Check that the object type exists and is an entity type.
    const objectType = model.getObjectType(oft.objectTypeId);
    if (!objectType) {
      diagnostics.push(
        report(RULE_ID.objectifiedDanglingObjectType, "default", oft.id, oft.objectTypeId),
      );
    } else if (objectType.kind !== "entity") {
      diagnostics.push(
        report(RULE_ID.objectifiedNotEntity, "default", oft.id, objectType.name, objectType.kind),
      );
    }

    // Check for duplicate objectification of the same fact type.
    if (seenFactTypes.has(oft.factTypeId)) {
      diagnostics.push(report(RULE_ID.duplicateObjectification, "default", oft.id, oft.factTypeId));
    }
    seenFactTypes.add(oft.factTypeId);

    // Check for duplicate use of the same object type as objectification.
    if (seenObjectTypes.has(oft.objectTypeId)) {
      diagnostics.push(
        report(RULE_ID.duplicateObjectificationTarget, "default", oft.id, oft.objectTypeId),
      );
    }
    seenObjectTypes.add(oft.objectTypeId);
  }

  return diagnostics;
}
