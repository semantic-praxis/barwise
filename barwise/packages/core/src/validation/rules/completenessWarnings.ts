import {
  IDENTIFICATION_SOURCE_LABEL,
  type IdentificationSource,
  identificationSources,
  isIdentified,
  preferredIdentifiers,
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
  diagnostics.push(...checkFrequencyWithoutEffect(model));

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
 * finished specifying business rules for that relationship. A constraint
 * across fact types counts for every fact type it touches, and for no
 * other -- not for the one a 2.0 file happened to nest it under.
 */
function checkFactTypesWithoutConstraints(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    if (model.constraintsTouching(ft.id).length === 0) {
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
    if (ft.arity < 2 || model.constraintsTouching(ft.id).length === 0) continue;
    const hasUniqueness = ft.internalConstraints.some(
      (c) => c.type === "internal_uniqueness",
    );
    if (!hasUniqueness) {
      diagnostics.push(report(RULE_ID.factTypeWithoutUniqueness, "default", ft.id, ft.name));
    }
  }

  return diagnostics;
}

/**
 * Each entity type should have exactly one preferred identifier. Zero
 * means the relational mapper must guess; more than one is contradictory.
 *
 * Both halves read core's answers rather than an enumeration written
 * here (orm-format-3 WS4a). Whether the entity is identified is
 * `isIdentified` -- an identifying uniqueness, an objectification, or an
 * identifying subtype of an identified supertype -- the same question the
 * query anchors, the annotator and NORMA export ask. A second enumeration
 * here once left 25 objectified entity types reported as unidentified
 * while the mapper keyed them by their objectification (barwise-972), and
 * once counted any flag on a fact type the entity played as its own.
 *
 * The MULTIPLE arm counts the flags that name this entity
 * (`identificationSources`, from `preferredIdentifiers`' candidates),
 * before the tie-break that picks one, so resolving them cannot hide the
 * error, and it runs first: two flags are what the modeller has to fix.
 * It counts preferred uniqueness alone. Objectifying a fact type and also
 * carrying a reference scheme is ordinary ORM -- "Review has ReviewId" on a
 * Review that objectifies "Reviewer reviews Paper" -- so counting other
 * kinds here would charge good modelling, which is the measurement
 * recorded on `identificationSources` itself.
 */
function checkPreferredIdentifiers(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const identifiers = preferredIdentifiers(model);

  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;
    const preferredCount = identificationSources(model, ot, identifiers)
      .filter((s) => s.kind === "preferred-uniqueness").length;

    if (preferredCount > 1) {
      diagnostics.push(
        report(RULE_ID.multiplePreferredIdentifiers, "default", ot.id, ot.name, preferredCount),
      );
    } else if (!isIdentified(model, ot.id, identifiers)) {
      diagnostics.push(report(RULE_ID.missingPreferredIdentifier, "default", ot.id, ot.name));
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
  const identifiers = preferredIdentifiers(model);

  for (const ot of model.objectTypes) {
    const kinds = new Set<IdentificationSource["kind"]>(
      identificationSources(model, ot, identifiers).map((s) => s.kind),
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

/**
 * A frequency constraint of "at least 1, at most unbounded" excludes
 * nothing, and until barwise-943 nothing said so.
 *
 * Halpin's counting semantics is that a frequency constraint applies
 * only to the instances that DO play the role, so every counted
 * instance already occurs at least once. "At least 1, no maximum" is
 * therefore exactly as empty as "at least 0" -- which barwise already
 * rejects outright as `constraint/frequency-invalid-min` (barwise-830).
 * The two vacuous spellings were treated as opposites: one a hard
 * error, the other indistinguishable from a real constraint, so a
 * modeller writing the second got no signal that the line they just
 * added says nothing while it verbalized and diagrammed as though it
 * constrained something.
 *
 * A WARNING rather than an error, and the distinction is the artifact
 * rather than the modeller. A min of 0 cannot be serialized and read
 * back at all (barwise-942), so it is a defect in the file; this is a
 * legal model carrying a useless line. Errors stay reserved for the
 * former.
 *
 * THE BOUNDARY IS THE WHOLE RULE. A minimum of 1 with a FINITE maximum
 * is not vacuous -- "at most 5" is the entire content of that
 * constraint, and 1..5 is the ordinary way to write it. All six
 * frequency constraints shipped in this repository are of that form, so
 * a rule that flagged them would be wrong six times over on its first
 * run. Only an unbounded maximum with a minimum of 1 or less is empty.
 */
function checkFrequencyWithoutEffect(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const c of ft.internalConstraints) {
      if (c.type !== "frequency") continue;
      if (c.max === "unbounded" && c.min <= 1) {
        diagnostics.push(report(RULE_ID.frequencyWithoutEffect, "default", ft.id, ft.name, c.min));
      }
    }
  }

  return diagnostics;
}
