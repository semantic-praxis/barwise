import { describeConstraintRepeat } from "../../model/Constraint.js";
import { isScopedView } from "../../model/DiagramLayout.js";
import type { ModelGraph } from "../../model/graph.js";
import { identificationOrder } from "../../model/identification.js";
import { type Mintable, mintedKey } from "../../model/mint.js";
import { localName, localNameEncodes } from "../../model/name.js";
import { objectificationRef } from "../../model/ObjectifiedFactType.js";
import type { OrmModel } from "../../model/OrmModel.js";
import { subtypeFactRef, subtypePairKey } from "../../model/SubtypeFact.js";
import { groupRepeats } from "../../util/groupRepeats.js";
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
 * - No two constraints share an id.
 * - No two subtype facts relate the same pair.
 * - What format 4.0 will do to names: ids that would collide, and ids that
 *   would be percent-encoded (`checkLocalNames`).
 *
 * What is NOT here any more: whether each of those references resolves
 * at all. `graphOf` owns that, so these rules receive a graph in which
 * every id already names something, and read the thing rather than the
 * id. The diagnostic ids did not move with the checks -- a dangling
 * player still reports `structural/dangling-role-reference` -- because
 * a rule id is a promise to whoever reads validator output.
 *
 * They ship as two exports rather than one, and the split is worth more
 * than it looks. Eight of the eleven checks read no reference at all: three
 * compare names, one counts readings, one walks subtype ids as a graph
 * of ids, one checks a diagram's ids, and two compare element ids. Left in the graph-taking export they would be suppressed
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
  diagnostics.push(...checkStaleMintedNames(model));

  return diagnostics;
}

/**
 * The structural checks that need no resolved graph, so they run whether
 * or not the model's conceptual references resolve.
 */
export function structuralWellFormedness(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkDuplicateObjectTypeNames(model));
  diagnostics.push(...checkDuplicateFactTypeNames(model));
  diagnostics.push(...checkLocalNames(model));
  diagnostics.push(...checkIdsFromNames(model));
  diagnostics.push(...checkAliases(model));
  diagnostics.push(...checkBinaryFactTypeReadings(model));
  diagnostics.push(...checkSubtypeCycles(model));
  diagnostics.push(...checkDiagramReferences(model));
  diagnostics.push(...checkDuplicateConstraintIds(model));
  diagnostics.push(...checkDuplicateSubtypeFacts(model));
  diagnostics.push(...checkStoredIds(model));

  return diagnostics;
}

/**
 * What the file states of the ids its model holds (iri-identity WS6): a
 * file before 4.0 states none of them, once, at the top of the file; a
 * 4.0 file that gives an element no id, each one (decision 17). The
 * first is the owner's choice for barwise-wcg.frh: every message names
 * elements by their 4.0 ids, and this one says why and how to move on.
 */
function checkStoredIds(model: OrmModel): Diagnostic[] {
  if (model.priorIds !== undefined) return [report(RULE_ID.replayedIds, "default", "")];
  return model.unstoredIds.map((id) => report(RULE_ID.unstoredId, "default", id, id));
}

/**
 * No two constraints may share an id.
 *
 * Constraints are arrays, so the model can hold the duplicate, and a
 * defect the model can hold is validation's to report
 * (`docs/specs/model-invariants.spec.md`). The 3.0 loader refuses one; a
 * 2.0 file, a model built in code and a merge do not, and before this rule
 * a merge wrote a file the 3.0 loader then refused to read back
 * (barwise-b2s). Both group through `groupRepeats`, so they agree on what
 * a repeat is. Reported once per id, naming every holder.
 *
 * The diagnostic's element is the shared id, and an editor that maps ids
 * to YAML nodes can place it on only one of the holders; the message names
 * all of them.
 */
function checkDuplicateConstraintIds(model: OrmModel): Diagnostic[] {
  return [...model.constraintsSharingAnId()].map(([id, holders]) =>
    report(
      RULE_ID.duplicateConstraintId,
      "default",
      id,
      describeConstraintRepeat(id, holders.map(([c, ft]) => [c, ft?.name] as const)),
    )
  );
}

/**
 * No two subtype facts may relate the same subtype to the same supertype.
 *
 * `OrmModel.addSubtypeFact` refuses the pair except under a lenient load,
 * so a lenient load can hold two such subtype facts under different ids,
 * and nothing reported them. Two that also share an id never reach this
 * rule: the store refuses the second (`DuplicateIdError`, workstream 3 of
 * the spec). Reported once per pair, naming every id, as the constraint
 * rule reports once per id. Names fall back to the id, so a dangling end
 * still lets the duplicate be seen.
 */
function checkDuplicateSubtypeFacts(model: OrmModel): Diagnostic[] {
  const nameOf = (id: string) => model.getObjectType(id)?.name ?? id;
  return [...groupRepeats(model.subtypeFacts, subtypePairKey).values()]
    .map((list) =>
      report(
        RULE_ID.duplicateSubtypeFact,
        "default",
        subtypeFactRef(list[1]!),
        list.map((sf) => `"${subtypeFactRef(sf)}"`).join(", "),
        nameOf(list[0]!.subtypeId),
        nameOf(list[0]!.supertypeId),
      )
    );
}

/**
 * Every id a saved diagram names should belong to an element. A stale
 * entry breaks nothing conceptual, so this is a warning: the entry is
 * ignored when the view renders. `OrmModel` removal and merge prune ids
 * as they go; what reaches here is a hand edit or a 1.x name the 2.0
 * migration could not resolve. The diagram's name stands in as the
 * element id, since a layout has no id of its own.
 */
function checkDiagramReferences(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const isObjectType = (id: string) => model.getObjectType(id) !== undefined;
  const isFactType = (id: string) => model.getFactType(id) !== undefined;
  // Each field resolves only the kinds the diagram session reads from it:
  // a fact type id in `elements` is ignored as surely as a missing one.
  type Field = [string, readonly string[], (id: string) => boolean, string];
  for (const layout of model.diagramLayouts) {
    // [] is a legitimate empty view (2.0), not a dangling reference, but it
    // is almost always what is left after a removal emptied the view, and
    // nothing else would tell the user their view now draws nothing.
    if (isScopedView(layout) && layout.elements.length === 0) {
      diagnostics.push(report(RULE_ID.diagramEmptyView, "default", layout.name, layout.name));
    }
    const refs: Field[] = [
      ["elements", layout.elements ?? [], isObjectType, "object type"],
      [
        "positions",
        Object.keys(layout.positions),
        (id) => isObjectType(id) || isFactType(id),
        "object type or fact type",
      ],
      ["orientations", Object.keys(layout.orientations), isFactType, "fact type"],
    ];
    for (const [field, ids, resolves, expected] of refs) {
      for (const id of ids) {
        if (!resolves(id)) {
          diagnostics.push(
            report(
              RULE_ID.diagramDanglingReference,
              "default",
              layout.name,
              layout.name,
              field,
              id,
              expected,
            ),
          );
        }
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
 * Ids and names, in format 4.0, where an element's id is its name through
 * `localName` (decision 13), object types and fact types share one
 * namespace, and a role's id is its fact type's id and its role name:
 *
 * - two elements holding one id collide. A 4.0 load refuses that, so only
 *   a model built in code reaches this. (A fact type and the object type
 *   objectifying it cannot share one: the objectification refuses it.);
 * - roles of one fact type whose role names give one id collide, reported
 *   once per group, and so does a role whose id a population holds;
 * - a name whose local name is more than its whitespace turned to `_`
 *   gets an encoded id, which is worth seeing once.
 *
 * Two names with one local name no longer collide: the second element
 * takes a suffixed id, which `checkIdsFromNames` reports.
 */
function checkLocalNames(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const elements = [
    ...model.objectTypes.map((e) => ({ kind: "object type", id: e.id, name: e.name })),
    ...model.factTypes.map((e) => ({ kind: "fact type", id: e.id, name: e.name })),
  ];
  const seen = new Map<string, { kind: string; id: string; name: string; }>();
  for (const e of elements) {
    if (localNameEncodes(e.name)) {
      diagnostics.push(
        report(RULE_ID.encodedLocalName, "default", e.id, e.kind, e.name, localName(e.name)),
      );
    }
    const first = seen.get(e.id);
    if (!first) {
      seen.set(e.id, e);
      continue;
    }
    diagnostics.push(
      report(
        RULE_ID.localNameCollision,
        "default",
        e.id,
        e.name,
        e.kind,
        first.name,
        first.kind,
        e.id,
      ),
    );
  }

  const populationIds = new Set(model.populations.map((p) => p.id));
  for (const ft of model.factTypes) {
    const groups = new Map<string, { id: string; name: string; }[]>();
    for (const role of ft.roles) {
      const local = localName(role.name);
      if (localNameEncodes(role.name)) {
        diagnostics.push(
          report(
            RULE_ID.encodedLocalName,
            "default",
            role.id,
            "role",
            role.name,
            `${ft.id}.${local}`,
          ),
        );
      }
      groups.set(local, [...(groups.get(local) ?? []), { id: role.id, name: role.name }]);
      if (populationIds.has(role.id)) {
        diagnostics.push(
          report(RULE_ID.localNameCollision, "population", role.id, ft.name, role.id),
        );
      }
    }
    for (const [local, roles] of groups) {
      if (roles.length < 2) continue;
      const names = roles.map((r) => `"${r.name}"`).join(", ");
      diagnostics.push(
        report(
          RULE_ID.duplicateRoleName,
          "default",
          roles[1]!.id,
          ft.name,
          names,
          `${ft.id}.${local}`,
        ),
      );
    }
  }
  return diagnostics;
}

/**
 * Each object type, fact type and role whose id is not the one its name
 * gives (decision 13): `localName(name)`, and a role's fact type id, a
 * `.`, and its role name's. A suffixed id, which a load or an add gives
 * when the id is taken, is said to be one. Exempt: a shadow, whose id is
 * its owner's behind an alias; and a fact type its objectifying type's
 * name would collide with, whose id comes from its first reading
 * (decision 20), until a rename of either type ends the collision.
 */
function checkIdsFromNames(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const check = (kind: string, name: string, id: string, expected: string) => {
    if (id === expected) return;
    const suffixed = id.startsWith(`${expected}_`) && /^\d+$/.test(id.slice(expected.length + 1));
    diagnostics.push(
      report(
        RULE_ID.idNotFromName,
        suffixed ? "suffixed" : "default",
        id,
        kind,
        name,
        id,
        expected,
      ),
    );
  };
  const objectifier = new Map(
    model.objectifiedFactTypes.map((o) => [o.factTypeId, o.objectTypeId] as const),
  );
  for (const ot of model.objectTypes) {
    if (!ot.id.includes(":")) check("object type", ot.name, ot.id, localName(ot.name));
  }
  for (const ft of model.factTypes) {
    const exempt = localName(ft.name) === objectifier.get(ft.id);
    if (!exempt) check("fact type", ft.name, ft.id, localName(ft.name));
    // A role whose name another role of its fact type shares is reported
    // once, by `duplicate-role-name`, which says why its id is suffixed.
    const locals = ft.roles.map((r) => localName(r.name));
    ft.roles.forEach((role, i) => {
      if (locals.indexOf(locals[i]!) !== locals.lastIndexOf(locals[i]!)) return;
      check("role", role.name, role.id, `${ft.id}.${locals[i]}`);
    });
  }
  return diagnostics;
}

/**
 * Each object type whose id names an alias the model does not import: a
 * shadow's id is `<alias>:<local name>`, and nothing else says which
 * context the alias means. Not a refusal at the add, because the lenient
 * loads (validate, the editor, merge's incoming side) must load such a
 * file to report it.
 */
function checkAliases(model: OrmModel): Diagnostic[] {
  return model.objectTypes.flatMap((ot) => {
    const colon = ot.id.indexOf(":");
    if (colon < 0) return [];
    const alias = ot.id.slice(0, colon);
    return model.imports.has(alias)
      ? []
      : [report(RULE_ID.aliasNotImported, "default", ot.id, ot.id, alias)];
  });
}

/**
 * Each minted id whose element now says something other than what it was
 * minted from (decision 14): its stored key against the key minting it now
 * would give. A graph rule, run only when the graph builds, so a dangling
 * reference is reported once, as itself. An id with no stored key was
 * written by a person or a tool and is never stale.
 */
function checkStaleMintedNames(model: OrmModel): Diagnostic[] {
  const stale = (kind: string, id: string | undefined, element: Mintable) => {
    if (id === undefined) return [];
    const stored = model.mintedFromOf(id);
    if (stored === undefined) return [];
    const now = mintedKey(element, model);
    return now === undefined || now === stored
      ? []
      : [report(RULE_ID.staleMintedName, "default", id, kind, id)];
  };
  return [
    ...model.everyConstraint().flatMap((inView) =>
      stale("constraint", inView[0].id, { kind: "constraint", inView })
    ),
    ...model.subtypeFacts.flatMap((sf) =>
      stale("subtype fact", sf.id, { kind: "subtypeFact", subtypeFact: sf })
    ),
    ...model.objectifiedFactTypes.flatMap((o) =>
      stale("objectification", o.id, { kind: "objectification", objectification: o })
    ),
  ];
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
        report(
          RULE_ID.subtypeNotEntity,
          "subtypeSide",
          subtypeFactRef(sf),
          subtype.name,
          subtype.kind,
        ),
      );
    }

    const supertype = graph.objectType(sf.supertypeId);
    if (supertype.kind !== "entity") {
      diagnostics.push(
        report(
          RULE_ID.subtypeNotEntity,
          "supertypeSide",
          subtypeFactRef(sf),
          supertype.name,
          supertype.kind,
        ),
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
        report(
          RULE_ID.objectifiedNotEntity,
          "default",
          objectificationRef(oft),
          objectType.name,
          objectType.kind,
        ),
      );
    }

    // Check for duplicate objectification of the same fact type.
    if (seenFactTypes.has(oft.factTypeId)) {
      diagnostics.push(
        report(
          RULE_ID.duplicateObjectification,
          "default",
          objectificationRef(oft),
          oft.factTypeId,
        ),
      );
    }
    seenFactTypes.add(oft.factTypeId);

    // Check for duplicate use of the same object type as objectification.
    if (seenObjectTypes.has(oft.objectTypeId)) {
      diagnostics.push(
        report(
          RULE_ID.duplicateObjectificationTarget,
          "default",
          objectificationRef(oft),
          oft.objectTypeId,
        ),
      );
    }
    seenObjectTypes.add(oft.objectTypeId);
  }

  return diagnostics;
}
