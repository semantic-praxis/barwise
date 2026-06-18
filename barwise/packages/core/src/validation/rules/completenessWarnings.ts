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
 * Each entity type should have exactly one preferred identifier
 * (an internal uniqueness constraint with isPreferred = true on one
 * of its identifying fact types). Zero means the relational mapper
 * must guess; more than one is contradictory.
 */
function checkPreferredIdentifiers(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;

    const factTypes = model.factTypesForObjectType(ot.id);
    let preferredCount = 0;

    for (const ft of factTypes) {
      for (const c of ft.constraints) {
        if (c.type === "internal_uniqueness" && c.isPreferred) {
          preferredCount++;
        }
      }
    }

    if (preferredCount === 0) {
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
