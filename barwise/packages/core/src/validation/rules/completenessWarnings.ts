import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";

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
 */
export function completenessWarnings(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkMissingObjectTypeDefinitions(model));
  diagnostics.push(...checkFactTypesWithoutConstraints(model));
  diagnostics.push(...checkFactTypesWithoutUniqueness(model));
  diagnostics.push(...checkIsolatedObjectTypes(model));
  diagnostics.push(...checkMissingValueTypeDataType(model));
  diagnostics.push(...checkPreferredIdentifiers(model));

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
      diagnostics.push({
        severity: "info",
        message: `Object type "${ot.name}" has no definition.`,
        elementId: ot.id,
        ruleId: "completeness/missing-object-type-definition",
      });
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
      diagnostics.push({
        severity: "warning",
        message: `Fact type "${ft.name}" has no constraints. `
          + `Most fact types need at least a uniqueness constraint.`,
        elementId: ft.id,
        ruleId: "completeness/fact-type-without-constraints",
      });
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
      diagnostics.push({
        severity: "info",
        message: `Object type "${ot.name}" does not participate in any fact type.`,
        elementId: ot.id,
        ruleId: "completeness/isolated-object-type",
      });
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
      diagnostics.push({
        severity: "info",
        message: `Value type "${ot.name}" has no data type. `
          + `The relational mapper will default to TEXT.`,
        elementId: ot.id,
        ruleId: "completeness/missing-value-type-data-type",
      });
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
      diagnostics.push({
        severity: "warning",
        message: `Fact type "${ft.name}" has constraints but no internal `
          + `uniqueness constraint. Without one, any combination of role values `
          + `can repeat freely -- state the intended cardinality.`,
        elementId: ft.id,
        ruleId: "completeness/fact-type-without-uniqueness",
      });
    }
  }

  return diagnostics;
}

/**
 * Each entity type should have exactly one preferred identifier
 * (an internal uniqueness constraint with isPreferred = true on one
 * of its identifying fact types). Zero means the relational mapper
 * must guess; more than one is contradictory. A subtype that inherits
 * identification -- a provides_identification path to a supertype
 * with a preferred identifier -- is identified through that chain and
 * is not flagged.
 */
function checkPreferredIdentifiers(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  const preferredCounts = new Map<string, number>();
  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;
    let count = 0;
    for (const ft of model.factTypesForObjectType(ot.id)) {
      for (const c of ft.constraints) {
        if (c.type === "internal_uniqueness" && c.isPreferred) count++;
      }
    }
    preferredCounts.set(ot.id, count);
  }

  /** Is this entity identified, directly or through its subtype chain? */
  const isIdentified = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false; // subtype cycle: structural rule reports it
    seen.add(id);
    if ((preferredCounts.get(id) ?? 0) > 0) return true;
    return model.subtypeFacts.some(
      (sf) =>
        sf.subtypeId === id
        && sf.providesIdentification
        && isIdentified(sf.supertypeId, seen),
    );
  };

  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;
    const preferredCount = preferredCounts.get(ot.id) ?? 0;

    if (preferredCount === 0 && !isIdentified(ot.id, new Set())) {
      diagnostics.push({
        severity: "info",
        message: `Entity type "${ot.name}" has no preferred identifier. `
          + `The relational mapper will use a heuristic to determine the primary key.`,
        elementId: ot.id,
        ruleId: "completeness/missing-preferred-identifier",
      });
    } else if (preferredCount > 1) {
      diagnostics.push({
        severity: "warning",
        message: `Entity type "${ot.name}" has ${preferredCount} preferred identifiers. `
          + `Each entity should have exactly one.`,
        elementId: ot.id,
        ruleId: "completeness/multiple-preferred-identifiers",
      });
    }
  }

  return diagnostics;
}
