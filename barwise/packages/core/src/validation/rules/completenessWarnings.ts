import {
  IDENTIFICATION_SOURCE_LABEL,
  type IdentificationSource,
  identificationSources,
} from "../../model/identification.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";
import { report, RULE_ID } from "../ruleId.js";

/**
 * Completeness warning rules.
 *
 * These produce informational or warning diagnostics for elements
 * that are technically valid but likely incomplete:
 * - Object types without definitions.
 * - Fact types without any constraints (usually means the modeler
 *   hasn't finished specifying business rules).
 * - Object types not participating in any fact type (isolated types).
 * - Value types without a declared data type.
 * - Entity types with zero or multiple preferred identifiers.
 * - Object types that declare their identity in more than one way.
 */
export function completenessWarnings(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkMissingObjectTypeDefinitions(model));
  diagnostics.push(...checkFactTypesWithoutConstraints(model));
  diagnostics.push(...checkFactTypesWithoutUniqueness(model));
  diagnostics.push(...checkIsolatedObjectTypes(model));
  diagnostics.push(...checkMissingValueTypeDataType(model));
  diagnostics.push(...checkPreferredIdentifiers(model));
  diagnostics.push(...checkConflictingIdentification(model));

  return diagnostics;
}

/**
 * Object types without a definition are likely incomplete.
 * Definitions are part of the ubiquitous language and should be
 * provided for every concept.
 */
function checkMissingObjectTypeDefinitions(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ot of model.objectTypes) {
    if (!ot.definition) {
      diagnostics.push(report(RULE_ID.missingObjectTypeDefinition, "default", ot.id, ot.name));
    }
  }

  return diagnostics;
}

/**
 * Fact types without constraints usually indicate the modeler hasn't
 * finished specifying business rules for that relationship.
 */
function checkFactTypesWithoutConstraints(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    if (ft.constraints.length === 0) {
      diagnostics.push(report(RULE_ID.factTypeWithoutConstraints, "default", ft.id, ft.name));
    }
  }

  return diagnostics;
}

/**
 * Object types that do not participate in any fact type are isolated.
 * They may be placeholders that need to be connected, or leftovers
 * from editing.
 */
function checkIsolatedObjectTypes(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ot of model.objectTypes) {
    // Independent object types may exist standalone by design, so a lack
    // of fact participation is intentional, not a completeness gap.
    if (ot.independent) continue;
    const participations = model.factTypesForObjectType(ot.id);
    if (participations.length === 0) {
      diagnostics.push(report(RULE_ID.isolatedObjectType, "default", ot.id, ot.name));
    }
  }

  return diagnostics;
}

/**
 * Value types without a data type will cause the relational mapper to
 * default column types to TEXT, which may not be desirable.
 */
function checkMissingValueTypeDataType(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ot of model.objectTypes) {
    if (ot.kind === "value" && !ot.dataType) {
      diagnostics.push(report(RULE_ID.missingValueTypeDataType, "default", ot.id, ot.name));
    }
  }

  return diagnostics;
}

/**
 * A fact type whose constraints omit internal uniqueness is usually
 * under-specified: without a uniqueness constraint every role can fan
 * out freely, which is rarely the intended business rule once other
 * constraints (mandatory, value) have been stated. Unaries are exempt
 * (their uniqueness semantics are implicit), and constraint-free fact
 * types are already covered by fact-type-without-constraints.
 */
function checkFactTypesWithoutUniqueness(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    if (ft.arity < 2 || ft.constraints.length === 0) continue;
    const hasUniqueness = ft.constraints.some(
      (c) => c.type === "internal_uniqueness",
    );
    if (!hasUniqueness) {
      diagnostics.push(report(RULE_ID.factTypeWithoutUniqueness, "default", ft.id, ft.name));
    }
  }

  return diagnostics;
}

/**
 * Each entity type should have exactly one preferred identifier
 * (an internal uniqueness constraint with isPreferred = true on one
 * of its identifying fact types). Zero means the relational mapper
 * must guess; more than one is contradictory.
 *
 * What counts as identified is `identificationSources`, not a second
 * enumeration written here. It was one, and it knew about a preferred
 * uniqueness constraint and an identifying subtype fact but not about
 * objectification -- so 25 objectified entity types across this
 * repository were told the mapper must guess their key, while
 * `settleObjectifiedKey` was building it from the absorbed columns and
 * `identificationGraph` was treating the objectification as an
 * identifying edge (barwise-972). An entity that objectifies a fact
 * type is identified BY that fact type; that is what objectification
 * means.
 *
 * `checkConflictingIdentification`, twenty lines down this same file,
 * was already reading the shared owner. Two rules in one file
 * disagreeing about what identifies an entity is the shape the
 * duplication rule exists to catch.
 *
 * The MULTIPLE arm still counts preferred uniqueness alone. Objectifying
 * a fact type and also carrying a reference scheme is ordinary ORM --
 * "Review has ReviewId" on a Review that objectifies "Reviewer reviews
 * Paper" -- so counting other kinds here would charge good modelling,
 * which is the measurement recorded on `identificationSources` itself.
 */
function checkPreferredIdentifiers(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const sourcesOf = new Map<string, readonly IdentificationSource[]>();
  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;
    sourcesOf.set(ot.id, identificationSources(model, ot));
  }
  const countOf = (id: string, kind: IdentificationSource["kind"]): number =>
    (sourcesOf.get(id) ?? []).filter((s) => s.kind === kind).length;

  /**
   * Is this entity identified, directly or through its subtype chain?
   *
   * The subtype arm recurses because `identificationSources` reports an
   * identifying subtype fact without asking whether the SUPERTYPE is
   * itself identified -- inheriting from an unidentified parent
   * identifies nothing.
   */
  const isIdentified = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false; // subtype cycle: structural rule reports it
    seen.add(id);
    const sources = sourcesOf.get(id) ?? [];
    if (sources.some((s) => s.kind !== "identifying-subtype")) return true;
    return sources.some(
      (s) => s.kind === "identifying-subtype" && isIdentified(s.supertypeId, seen),
    );
  };

  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;
    const preferredCount = countOf(ot.id, "preferred-uniqueness");

    if (preferredCount === 0 && !isIdentified(ot.id, new Set())) {
      diagnostics.push(report(RULE_ID.missingPreferredIdentifier, "default", ot.id, ot.name));
    } else if (preferredCount > 1) {
      diagnostics.push(
        report(RULE_ID.multiplePreferredIdentifiers, "default", ot.id, ot.name, preferredCount),
      );
    }
  }

  return diagnostics;
}

/**
 * An object type that inherits its identity must not also declare one.
 *
 * `checkPreferredIdentifiers` above covers more than one source of ONE
 * kind -- two preferred uniqueness constraints. This covers the
 * cross-kind case that nothing reported: a subtype fact declaring
 * `providesIdentification` says "this type is identified by its
 * supertype's identifier", and a type that says that AND objectifies a
 * fact type, or AND carries its own preferred identifier, has declared
 * its identity twice. That is not an identification CYCLE, so
 * `structural/identification-cycle` does not fire either -- the graph
 * simply has two out-edges from one node.
 *
 * It is worth reporting because it has already cost a defect:
 * barwise-965's truncated composite key was only reachable through the
 * objectification-plus-subtype shape. The mapper now resolves it -- the
 * objectification wins, being the more specific statement -- and that
 * resolution is unchanged here. A modeller who wrote both probably
 * meant one, and until now nothing told them.
 *
 * A preferred uniqueness constraint on an OBJECTIFIED type is
 * deliberately not a conflict. ORM lets an objectified fact type carry
 * its own reference scheme -- "Review has ReviewId" on a Review that
 * objectifies "Reviewer reviews Paper" is ordinary modelling, not a
 * contradiction. A first draft of this rule fired on it, and the
 * measurement is why it does not: 13 of the 115 recorded eval payloads
 * carry exactly that shape, from four different model arms, and
 * charging them would have moved six of eight arms' scores for good
 * modelling.
 */
function checkConflictingIdentification(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ot of model.objectTypes) {
    const kinds = new Set<IdentificationSource["kind"]>(
      identificationSources(model, ot).map((s) => s.kind),
    );
    if (!kinds.has("identifying-subtype") || kinds.size < 2) continue;

    const others = [...kinds].filter((k) => k !== "identifying-subtype");
    diagnostics.push(
      report(
        RULE_ID.conflictingIdentification,
        "default",
        ot.id,
        ot.name,
        others.map((k) => IDENTIFICATION_SOURCE_LABEL[k]).join(" and "),
      ),
    );
  }

  return diagnostics;
}
