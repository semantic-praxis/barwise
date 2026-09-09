import type { ModelGraph } from "../../model/graph.js";
import { identificationOrder } from "../../model/identification.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";
import { report, RULE_ID } from "../ruleId.js";

/**
 * Structural validation rules.
 *
 * These check the basic well-formedness of the model:
 * - No duplicate object type names.
 * - No duplicate fact type names.
 * - Binary fact types have at least two readings (forward and inverse).
 * - Subtype facts relate entity types, not value types.
 * - Subtype hierarchy has no cycles.
 * - Objectified fact types objectify entity types.
 * - No duplicate objectification of the same fact type.
 *
 * What is NOT here any more: whether each of those references resolves
 * at all. `graphOf` owns that, so these rules receive a graph in which
 * every id already names something, and read the thing rather than the
 * id. The diagnostic ids did not move with the checks -- a dangling
 * player still reports `structural/dangling-role-reference` -- because
 * a rule id is a promise to whoever reads validator output.
 *
 * They ship as two exports rather than one, and the split is worth more
 * than it looks. Four of the seven checks read no reference at all: two
 * compare names, one counts readings, one walks subtype ids as a graph
 * of ids. Left in the graph-taking export they would be suppressed
 * whenever any id in the model dangled -- and `barwise validate` on a
 * file with one bad constraint role would stop reporting that a binary
 * fact type has only one reading, which has nothing to do with the bad
 * id. Splitting them keeps that cost (barwise-978) to the findings that
 * genuinely need resolution.
 */
export function structuralRules(model: OrmModel, graph: ModelGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkSubtypeFactKinds(model, graph));
  diagnostics.push(...checkObjectifiedFactTypeKinds(model, graph));
  diagnostics.push(...checkIdentificationCycles(model, graph));

  return diagnostics;
}

/**
 * The structural checks that read no reference, so they run whether or
 * not the model's ids resolve.
 */
export function structuralWellFormedness(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkDuplicateObjectTypeNames(model));
  diagnostics.push(...checkDuplicateFactTypeNames(model));
  diagnostics.push(...checkBinaryFactTypeReadings(model));
  diagnostics.push(...checkSubtypeCycles(model));

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
 * Both sides of a subtype fact must be entity types. That they exist at
 * all is the graph's guarantee, not this rule's question.
 */
function checkSubtypeFactKinds(model: OrmModel, graph: ModelGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const sf of model.subtypeFacts) {
    const subtype = graph.objectType(sf.subtypeId);
    if (subtype.kind !== "entity") {
      diagnostics.push(
        report(RULE_ID.subtypeNotEntity, "subtypeSide", sf.id, subtype.name, subtype.kind),
      );
    }

    const supertype = graph.objectType(sf.supertypeId);
    if (supertype.kind !== "entity") {
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
function checkIdentificationCycles(model: OrmModel, graph: ModelGraph): Diagnostic[] {
  const result = identificationOrder(model);
  if (!("cycle" in result)) return [];

  const names = result.cycle.map((id) => graph.objectType(id).name);
  return [
    report(RULE_ID.identificationCycle, "default", result.cycle[0]!, names.join(" -> ")),
  ];
}

/**
 * An objectified fact type must objectify an entity type, and no fact
 * type or entity type may be objectified twice. That both ends exist is
 * the graph's guarantee.
 */
function checkObjectifiedFactTypeKinds(model: OrmModel, graph: ModelGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const seenFactTypes = new Set<string>();
  const seenObjectTypes = new Set<string>();

  for (const oft of model.objectifiedFactTypes) {
    const objectType = graph.objectType(oft.objectTypeId);
    if (objectType.kind !== "entity") {
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
