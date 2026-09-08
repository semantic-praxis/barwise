/**
 * The closed set of rule identifiers core's validation emits, with the
 * severity and the message text each one owns.
 *
 * A rule's identity, its severity and its wording live here and nowhere
 * else: `report` reads all three, so an emit site names the rule and
 * supplies only the occurrence. The `Record` is the completeness idiom
 * `RING_TYPE_MEMBERS` established (barwise-869) -- the union is derived
 * from it, so an identifier used in a rule module but missing here is a
 * compile error, and the runtime list cannot lag the union.
 *
 * `messages` is a dictionary keyed by message id, following SARIF's
 * `reportingDescriptor.messageStrings`: nine rules report more than one
 * condition (`population/exclusion-violation` fires both for roles
 * within a fact type and for roles spanning several) and SARIF names the
 * message rather than splitting the rule. The id maps onto a result's
 * `message.id` on export, so the distinction stays machine-readable.
 *
 * The descriptor is otherwise a subset of `reportingDescriptor`, stopping
 * where barwise can honestly fill it: no `helpUri`, because there is no
 * rule documentation to point at yet, and `severity` in barwise's own
 * vocabulary rather than SARIF's `level`, because core should not name an
 * interchange format it does not emit. Mapping `info` to `note` is the
 * exporter's job (barwise-948).
 *
 * `severity` is the default, not a guarantee: a deontic constraint lowers
 * a violation to a warning at report time (`severityForModality`), and
 * `constraint/spanning-all-roles` reports `info` on a binary fact type.
 * Those sites pass an override. SARIF draws the same distinction between
 * `defaultConfiguration.level` and a result's own `level`.
 *
 * A surface that mints identifiers of its own declares its own registry
 * of this shape; core does not learn about it. See `Diagnostic`.
 */

import type { DiagnosticSeverity } from "./severity.js";

/** Every rule identifier, by name, so no emit site repeats the string. */
export const RULE_ID = {
  factTypeWithoutConstraints: "completeness/fact-type-without-constraints",
  factTypeWithoutUniqueness: "completeness/fact-type-without-uniqueness",
  isolatedObjectType: "completeness/isolated-object-type",
  missingObjectTypeDefinition: "completeness/missing-object-type-definition",
  missingPreferredIdentifier: "completeness/missing-preferred-identifier",
  missingValueTypeDataType: "completeness/missing-value-type-data-type",
  multiplePreferredIdentifiers: "completeness/multiple-preferred-identifiers",
  cardinalityInvalidRole: "constraint/cardinality-invalid-role",
  cardinalityMaxLessThanMin: "constraint/cardinality-max-less-than-min",
  cardinalityNonUnary: "constraint/cardinality-non-unary",
  disjunctiveMandatoryTooFewRoles: "constraint/disjunctive-mandatory-too-few-roles",
  equalityArityMismatch: "constraint/equality-arity-mismatch",
  exclusionTooFewRoles: "constraint/exclusion-too-few-roles",
  exclusiveOrTooFewRoles: "constraint/exclusive-or-too-few-roles",
  externalUniquenessAllLocal: "constraint/external-uniqueness-all-local",
  frequencyEmptyRoles: "constraint/frequency-empty-roles",
  frequencyInvalidMin: "constraint/frequency-invalid-min",
  frequencyInvalidRole: "constraint/frequency-invalid-role",
  frequencyMaxLessThanMin: "constraint/frequency-max-less-than-min",
  internalUniquenessInvalidRole: "constraint/internal-uniqueness-invalid-role",
  joinArityMismatch: "constraint/join-arity-mismatch",
  joinBadProjection: "constraint/join-bad-projection",
  joinBadStep: "constraint/join-bad-step",
  joinColumnTypeMismatch: "constraint/join-column-type-mismatch",
  joinDiscontiguous: "constraint/join-discontiguous",
  joinEmptyProjection: "constraint/join-empty-projection",
  joinTooFewOperands: "constraint/join-too-few-operands",
  joinUnknownRoot: "constraint/join-unknown-root",
  mandatoryInvalidRole: "constraint/mandatory-invalid-role",
  ringDifferentPlayers: "constraint/ring-different-players",
  ringInvalidRole: "constraint/ring-invalid-role",
  spanningAllRoles: "constraint/spanning-all-roles",
  subsetArityMismatch: "constraint/subset-arity-mismatch",
  valueComparisonInvalidRole: "constraint/value-comparison-invalid-role",
  valueConstraintInvalidRole: "constraint/value-constraint-invalid-role",
  derivedWithPopulation: "derivation/derived-with-population",
  missingRule: "derivation/missing-rule",
  danglingFactType: "population/dangling-fact-type",
  disjunctiveMandatoryViolation: "population/disjunctive-mandatory-violation",
  equalityViolation: "population/equality-violation",
  exclusionViolation: "population/exclusion-violation",
  exclusiveOrViolation: "population/exclusive-or-violation",
  externalUniquenessViolation: "population/external-uniqueness-violation",
  frequencyViolation: "population/frequency-violation",
  incompleteInstance: "population/incomplete-instance",
  mandatoryViolation: "population/mandatory-violation",
  objectCardinalityViolation: "population/object-cardinality-violation",
  subsetViolation: "population/subset-violation",
  unaryRoleCardinalityViolation: "population/unary-role-cardinality-violation",
  uniquenessViolation: "population/uniqueness-violation",
  valueComparisonViolation: "population/value-comparison-violation",
  valueConstraintViolation: "population/value-constraint-violation",
  entityMappingSourceMissing: "project/entity-mapping-source-missing",
  entityMappingTargetMissing: "project/entity-mapping-target-missing",
  mappingSourceContextMissing: "project/mapping-source-context-missing",
  mappingTargetContextMissing: "project/mapping-target-context-missing",
  productDomainDependencyMissing: "project/product-domain-dependency-missing",
  productMappingDependencyUnresolved: "project/product-mapping-dependency-unresolved",
  binaryMissingInverseReading: "structural/binary-missing-inverse-reading",
  danglingRoleReference: "structural/dangling-role-reference",
  duplicateFactTypeName: "structural/duplicate-fact-type-name",
  duplicateObjectTypeName: "structural/duplicate-object-type-name",
  duplicateObjectification: "structural/duplicate-objectification",
  duplicateObjectificationTarget: "structural/duplicate-objectification-target",
  objectifiedDanglingFactType: "structural/objectified-dangling-fact-type",
  objectifiedDanglingObjectType: "structural/objectified-dangling-object-type",
  objectifiedNotEntity: "structural/objectified-not-entity",
  identificationCycle: "structural/identification-cycle",
  subtypeCycle: "structural/subtype-cycle",
  subtypeDanglingSubtype: "structural/subtype-dangling-subtype",
  subtypeDanglingSupertype: "structural/subtype-dangling-supertype",
  subtypeNotEntity: "structural/subtype-not-entity",
  joinSubsetViolation: "population/join-subset-violation",
  joinEqualityViolation: "population/join-equality-violation",
  joinExclusionViolation: "population/join-exclusion-violation",
  ringViolation: "population/ring-violation",
  mergeError: "merge-error",
} as const;

/** What a rule reports, how loudly, and in what words. */
export interface RuleDescriptor {
  readonly severity: DiagnosticSeverity;
  readonly description: string;
  readonly messages: Readonly<Record<string, (...args: never[]) => string>>;
}

const RULE_DESCRIPTORS = {
  [RULE_ID.factTypeWithoutConstraints]: {
    severity: "warning",
    description:
      "A fact type carries no constraints at all, so nothing about its population is asserted.",
    messages: {
      default: (ftName: string): string =>
        `Fact type "${ftName}" has no constraints. Most fact types need at least a uniqueness constraint.`,
    },
  },
  [RULE_ID.factTypeWithoutUniqueness]: {
    severity: "warning",
    description:
      "A fact type has constraints but no internal uniqueness, so no combination of its roles is identified.",
    messages: {
      default: (ftName: string): string =>
        `Fact type "${ftName}" has constraints but no internal uniqueness constraint. Without one, any combination of role values can repeat freely -- state the intended cardinality.`,
    },
  },
  [RULE_ID.isolatedObjectType]: {
    severity: "info",
    description: "An object type plays no role in any fact type.",
    messages: {
      default: (otName: string): string =>
        `Object type "${otName}" does not participate in any fact type.`,
    },
  },
  [RULE_ID.missingObjectTypeDefinition]: {
    severity: "info",
    description: "An object type has no natural-language definition.",
    messages: {
      default: (otName: string): string => `Object type "${otName}" has no definition.`,
    },
  },
  [RULE_ID.missingPreferredIdentifier]: {
    severity: "info",
    description: "An entity type has no uniqueness constraint marked as its preferred identifier.",
    messages: {
      default: (otName: string): string =>
        `Entity type "${otName}" has no preferred identifier. The relational mapper will use a heuristic to determine the primary key.`,
    },
  },
  [RULE_ID.missingValueTypeDataType]: {
    severity: "info",
    description: "A value type declares no conceptual data type.",
    messages: {
      default: (otName: string): string =>
        `Value type "${otName}" has no data type. The relational mapper will default to TEXT.`,
    },
  },
  [RULE_ID.multiplePreferredIdentifiers]: {
    severity: "warning",
    description: "An entity type has more than one uniqueness constraint marked preferred.",
    messages: {
      default: (otName: string, preferredCount: number): string =>
        `Entity type "${otName}" has ${preferredCount} preferred identifiers. Each entity should have exactly one.`,
    },
  },
  [RULE_ID.cardinalityInvalidRole]: {
    severity: "error",
    description: "A cardinality constraint names a role that does not belong to its fact type.",
    messages: {
      default: (ftName: string, constraintRoleId: string): string =>
        `Cardinality constraint in fact type "${ftName}" references role id "${constraintRoleId}" which does not belong to this fact type.`,
    },
  },
  [RULE_ID.cardinalityMaxLessThanMin]: {
    severity: "error",
    description:
      "A cardinality constraint's maximum is below its minimum, so no population can satisfy it.",
    messages: {
      default: (
        ftName: string,
        constraintMax: number | "unbounded",
        constraintMin: number | "unbounded",
      ): string =>
        `Cardinality constraint in fact type "${ftName}" has max (${constraintMax}) less than min (${constraintMin}).`,
    },
  },
  [RULE_ID.cardinalityNonUnary]: {
    severity: "error",
    description: "A cardinality constraint is attached to a role of a fact type that is not unary.",
    messages: {
      default: (ftName: string, ftArity: number): string =>
        `Cardinality constraint in fact type "${ftName}" applies to a unary role, but the fact type has arity ${ftArity}.`,
    },
  },
  [RULE_ID.disjunctiveMandatoryTooFewRoles]: {
    severity: "error",
    description: "A disjunctive mandatory constraint spans fewer than two roles.",
    messages: {
      default: (ftName: string): string =>
        `Disjunctive mandatory constraint in fact type "${ftName}" must reference at least 2 roles.`,
    },
  },
  [RULE_ID.equalityArityMismatch]: {
    severity: "error",
    description: "An equality constraint compares two role sequences of different lengths.",
    messages: {
      default: (
        ftName: string,
        constraintRoleIds1Length: number,
        constraintRoleIds2Length: number,
      ): string =>
        `Equality constraint in fact type "${ftName}" has mismatched role sequence lengths: first has ${constraintRoleIds1Length} roles, second has ${constraintRoleIds2Length} roles.`,
    },
  },
  [RULE_ID.exclusionTooFewRoles]: {
    severity: "error",
    description: "An exclusion constraint spans fewer than two roles.",
    messages: {
      default: (ftName: string): string =>
        `Exclusion constraint in fact type "${ftName}" must reference at least 2 roles.`,
    },
  },
  [RULE_ID.exclusiveOrTooFewRoles]: {
    severity: "error",
    description: "An exclusive-or constraint spans fewer than two roles.",
    messages: {
      default: (ftName: string): string =>
        `Exclusive-or constraint in fact type "${ftName}" must reference at least 2 roles.`,
    },
  },
  [RULE_ID.externalUniquenessAllLocal]: {
    severity: "warning",
    description:
      "An external uniqueness constraint spans roles that all belong to one fact type, where an internal one would say the same thing.",
    messages: {
      default: (ftName: string): string =>
        `External uniqueness constraint in fact type "${ftName}" references only roles within this fact type. Consider using internal uniqueness instead.`,
    },
  },
  [RULE_ID.frequencyEmptyRoles]: {
    severity: "error",
    description: "A frequency constraint names no roles.",
    messages: {
      default: (ftName: string): string =>
        `Frequency constraint in fact type "${ftName}" must reference at least one role.`,
    },
  },
  [RULE_ID.frequencyInvalidMin]: {
    severity: "error",
    description:
      "A frequency constraint's minimum is below one; a frequency counts only the instances that do play the role, so a lower bound excludes nothing.",
    messages: {
      default: (ftName: string, constraintMin: number | "unbounded"): string =>
        `Frequency constraint in fact type "${ftName}" has min ${constraintMin}, which must be at least 1.`,
    },
  },
  [RULE_ID.frequencyInvalidRole]: {
    severity: "error",
    description: "A frequency constraint names a role that does not belong to its fact type.",
    messages: {
      default: (ftName: string, roleId: string): string =>
        `Frequency constraint in fact type "${ftName}" references role id "${roleId}" which does not belong to this fact type.`,
    },
  },
  [RULE_ID.frequencyMaxLessThanMin]: {
    severity: "error",
    description:
      "A frequency constraint's maximum is below its minimum, so no population can satisfy it.",
    messages: {
      default: (
        ftName: string,
        constraintMax: number | "unbounded",
        constraintMin: number | "unbounded",
      ): string =>
        `Frequency constraint in fact type "${ftName}" has max (${constraintMax}) less than min (${constraintMin}).`,
    },
  },
  [RULE_ID.internalUniquenessInvalidRole]: {
    severity: "error",
    description:
      "An internal uniqueness constraint names a role that does not belong to its fact type.",
    messages: {
      default: (ftName: string, roleId: string): string =>
        `Internal uniqueness constraint in fact type "${ftName}" references role id "${roleId}" which does not belong to this fact type.`,
    },
  },
  [RULE_ID.joinArityMismatch]: {
    severity: "error",
    description:
      "A join constraint's operands project tuples of different lengths, so they cannot be compared.",
    messages: {
      default: (ftName: string): string =>
        `Join constraint in fact type "${ftName}" has operands that project tuples of different arity; they must match.`,
    },
  },
  [RULE_ID.joinBadProjection]: {
    severity: "error",
    description: "A join constraint projects a path node that does not exist on the path.",
    messages: {
      default: (ftName: string, idx: number, nodeTypesLength1: number): string =>
        `Join constraint in fact type "${ftName}" projects node ${idx}, which is outside the path (0..${nodeTypesLength1}).`,
    },
  },
  [RULE_ID.joinBadStep]: {
    severity: "error",
    description:
      "A join constraint has a step whose entry and exit roles do not share a fact type.",
    messages: {
      default: (ftName: string, stepEntry: string, stepExit: string): string =>
        `Join constraint in fact type "${ftName}" has a step whose entry "${stepEntry}" / exit "${stepExit}" are not both roles of one fact type.`,
    },
  },
  [RULE_ID.joinColumnTypeMismatch]: {
    severity: "error",
    description: "A join constraint compares two projected columns whose object types differ.",
    messages: {
      default: (ftName: string, col1: number): string =>
        `Join constraint in fact type "${ftName}" projects column ${col1} from different object types across operands; they must match.`,
    },
  },
  [RULE_ID.joinDiscontiguous]: {
    severity: "error",
    description:
      "A join constraint's path is not contiguous: a step does not start where the previous one ended.",
    messages: {
      default: (ftName: string, stepEntry: string): string =>
        `Join constraint in fact type "${ftName}" is not contiguous: the entry role "${stepEntry}" is not played by the preceding path node.`,
    },
  },
  [RULE_ID.joinEmptyProjection]: {
    severity: "error",
    description: "A join constraint has an operand that projects no nodes.",
    messages: {
      default: (ftName: string): string =>
        `Join constraint in fact type "${ftName}" has an operand with an empty projection.`,
    },
  },
  [RULE_ID.joinTooFewOperands]: {
    severity: "error",
    description: "A join equality or exclusion constraint has fewer than two operands.",
    messages: {
      default: (cTypeJoinEqualityEqualityExclusion: string, ftName: string): string =>
        `Join ${cTypeJoinEqualityEqualityExclusion} constraint in fact type "${ftName}" must have at least two operands.`,
    },
  },
  [RULE_ID.joinUnknownRoot]: {
    severity: "error",
    description:
      "A join constraint's path is rooted at an object type that does not exist in the model.",
    messages: {
      default: (ftName: string, pathRoot: string): string =>
        `Join constraint in fact type "${ftName}" references an unknown root object type "${pathRoot}".`,
    },
  },
  [RULE_ID.mandatoryInvalidRole]: {
    severity: "error",
    description: "A mandatory constraint names a role that does not belong to its fact type.",
    messages: {
      default: (ftName: string, constraintRoleId: string): string =>
        `Mandatory constraint in fact type "${ftName}" references role id "${constraintRoleId}" which does not belong to this fact type.`,
    },
  },
  [RULE_ID.ringDifferentPlayers]: {
    severity: "error",
    description: "A ring constraint relates two roles played by different object types.",
    messages: {
      default: (ftName: string): string =>
        `Ring constraint in fact type "${ftName}" requires both roles to be played by the same object type.`,
    },
  },
  [RULE_ID.ringInvalidRole]: {
    severity: "error",
    description: "A ring constraint names a role that does not belong to its fact type.",
    messages: {
      default: (ftName: string, constraintRoleId1: string): string =>
        `Ring constraint in fact type "${ftName}" references role id "${constraintRoleId1}" which does not belong to this fact type.`,
    },
  },
  [RULE_ID.spanningAllRoles]: {
    severity: "warning",
    description:
      "An internal uniqueness constraint spans every role of its fact type, which permits duplicate tuples rather than identifying any.",
    messages: {
      default: (ftName: string, ftArity: number): string =>
        `Internal uniqueness constraint in fact type "${ftName}" spans all ${ftArity} roles. This means each complete fact can only appear once, which is often redundant.`,
    },
  },
  [RULE_ID.subsetArityMismatch]: {
    severity: "error",
    description: "A subset constraint compares two role sequences of different lengths.",
    messages: {
      default: (
        ftName: string,
        constraintSubsetRoleIdsLength: number,
        constraintSupersetRoleIdsLength: number,
      ): string =>
        `Subset constraint in fact type "${ftName}" has mismatched role sequence lengths: subset has ${constraintSubsetRoleIdsLength} roles, superset has ${constraintSupersetRoleIdsLength} roles.`,
    },
  },
  [RULE_ID.valueComparisonInvalidRole]: {
    severity: "error",
    description:
      "A value comparison constraint names a role that does not belong to its fact type.",
    messages: {
      default: (ftName: string, constraintRoleId1: string): string =>
        `Value comparison constraint in fact type "${ftName}" references role id "${constraintRoleId1}" which does not belong to this fact type.`,
    },
  },
  [RULE_ID.valueConstraintInvalidRole]: {
    severity: "error",
    description: "A value constraint names a role that does not belong to its fact type.",
    messages: {
      default: (ftName: string, constraintRoleId: string): string =>
        `Value constraint in fact type "${ftName}" references role id "${constraintRoleId}" which does not belong to this fact type.`,
    },
  },
  [RULE_ID.derivedWithPopulation]: {
    severity: "warning",
    description:
      "A purely derived fact type carries a stored population, which its rule would compute.",
    messages: {
      default: (ftName: string): string =>
        `Fact type "${ftName}" is purely derived (computed on request) but carries a sample population; its facts are not asserted.`,
    },
  },
  [RULE_ID.missingRule]: {
    severity: "warning",
    description: "A fact type is marked derived or semiderived but carries no derivation rule.",
    messages: {
      factType: (ftName: string, dKind: string): string =>
        `Fact type "${ftName}" is marked ${dKind} but has no derivation rule text.`,
      subtype: (subtypeName: string, dKind: string): string =>
        `Subtype "${subtypeName}" is marked ${dKind} but has no defining rule text.`,
    },
  },
  [RULE_ID.danglingFactType]: {
    severity: "error",
    description: "A population references a fact type that does not exist in the model.",
    messages: {
      default: (popId: string, popFactTypeId: string): string =>
        `Population "${popId}" references fact type id "${popFactTypeId}" which does not exist in the model.`,
    },
  },
  [RULE_ID.disjunctiveMandatoryViolation]: {
    severity: "error",
    description:
      "An object instance plays none of the roles a disjunctive mandatory constraint requires at least one of.",
    messages: {
      default: (cRoleIds: string, value: string): string =>
        `Disjunctive mandatory constraint on roles [${cRoleIds}] is violated: "${value}" plays none of them.`,
    },
  },
  [RULE_ID.equalityViolation]: {
    severity: "error",
    description: "A tuple appears in one side of an equality constraint and not the other.",
    messages: {
      local: (tuple: string, cRoleIds1: string, cRoleIds2: string): string =>
        `Equality constraint is violated: tuple [${tuple}] in roles [${cRoleIds1}] has no match in roles [${cRoleIds2}].`,
      localReverse: (tuple: string, cRoleIds2: string, cRoleIds1: string): string =>
        `Equality constraint is violated: tuple [${tuple}] in roles [${cRoleIds2}] has no match in roles [${cRoleIds1}].`,
      spanning: (
        popId: string,
        instId: string,
        key1: string,
        eqRoleIds1: string,
        eqRoleIds2: string,
      ): string =>
        `Population "${popId}": instance "${instId}" has tuple [${key1}] in roles [${eqRoleIds1}] with no matching tuple in roles [${eqRoleIds2}].`,
      spanningReverse: (
        popId: string,
        instId: string,
        key2: string,
        eqRoleIds2: string,
        eqRoleIds1: string,
      ): string =>
        `Population "${popId}": instance "${instId}" has tuple [${key2}] in roles [${eqRoleIds2}] with no matching tuple in roles [${eqRoleIds1}].`,
    },
  },
  [RULE_ID.exclusionViolation]: {
    severity: "error",
    description:
      "An object instance plays more than one of the roles an exclusion constraint forbids combining.",
    messages: {
      local: (cRoleIds: string, value: string, count: number): string =>
        `Exclusion constraint on roles [${cRoleIds}] is violated: "${value}" plays ${count} of the excluded roles.`,
      spanning: (popId: string, instId: string, val: string, roles: string): string =>
        `Population "${popId}": instance "${instId}" has value "${val}" in multiple excluded roles [${roles}].`,
    },
  },
  [RULE_ID.exclusiveOrViolation]: {
    severity: "error",
    description:
      "An object instance plays none of the roles an exclusive-or constraint requires exactly one of.",
    messages: {
      localMultiple: (cRoleIds: string, value: string, count: number): string =>
        `Exclusive-or constraint on roles [${cRoleIds}] is violated: "${value}" plays ${count} of them (must be exactly one).`,
      localNone: (
        popId: string,
        instId: string,
        playedRolesLength: number,
        playedRoles: string,
      ): string =>
        `Population "${popId}": instance "${instId}" plays ${playedRolesLength} of the exclusive-or roles [${playedRoles}] but must play exactly one.`,
      spanning: (popId: string, instId: string, localRoleIds: string): string =>
        `Population "${popId}": instance "${instId}" does not play any of the exclusive-or roles [${localRoleIds}].`,
    },
  },
  [RULE_ID.externalUniquenessViolation]: {
    severity: "error",
    description:
      "Two instances share the values an external uniqueness constraint requires to identify at most one.",
    messages: {
      default: (common: string, first: string, parts: string): string =>
        `External uniqueness constraint is violated: "${common}" and "${first}" share the same combination [${parts}].`,
    },
  },
  [RULE_ID.frequencyViolation]: {
    severity: "error",
    description:
      "A value or value combination occurs a number of times outside a frequency constraint's bounds.",
    messages: {
      aboveMaximum: (
        popId: string,
        subject: string,
        count: number,
        fcMin: number | "unbounded",
      ): string =>
        `Population "${popId}": ${subject} appears ${count} time(s) but the minimum is ${fcMin}.`,
      belowMinimum: (
        popId: string,
        subject: string,
        count: number,
        fcMax: number | "unbounded",
      ): string =>
        `Population "${popId}": ${subject} appears ${count} time(s) but the maximum is ${fcMax}.`,
    },
  },
  [RULE_ID.incompleteInstance]: {
    severity: "error",
    description: "A population instance leaves one or more of its fact type's roles unfilled.",
    messages: {
      default: (instId: string, ftName: string, names: string): string =>
        `Population instance "${instId}" of fact type "${ftName}" has no value for role(s) played by: ${names}. Every instance must fill every role of its fact type.`,
    },
  },
  [RULE_ID.mandatoryViolation]: {
    severity: "error",
    description:
      "An object instance in the model's universe does not play a role a mandatory constraint requires.",
    messages: {
      default: (cRoleId: string, ftName: string, value: string): string =>
        `Mandatory constraint on role "${cRoleId}" in fact type "${ftName}" is violated: "${value}" appears in the model but does not play this mandatory role.`,
    },
  },
  [RULE_ID.objectCardinalityViolation]: {
    severity: "error",
    description: "An object type's population size falls outside its declared cardinality bounds.",
    messages: {
      aboveMaximum: (otName: string, count: number, cardMin: number | "unbounded"): string =>
        `Object type "${otName}" has ${count} instance(s) in the population but its cardinality requires at least ${cardMin}.`,
      belowMinimum: (otName: string, count: number, cardMax: number | "unbounded"): string =>
        `Object type "${otName}" has ${count} instance(s) in the population but its cardinality allows at most ${cardMax}.`,
    },
  },
  [RULE_ID.subsetViolation]: {
    severity: "error",
    description:
      "A tuple appears in a subset constraint's subset side without appearing in its superset side.",
    messages: {
      local: (tuple: string, cSubsetRoleIds: string, cSupersetRoleIds: string): string =>
        `Subset constraint is violated: tuple [${tuple}] in roles [${cSubsetRoleIds}] has no match in roles [${cSupersetRoleIds}].`,
      spanning: (
        popId: string,
        instId: string,
        subsetKey: string,
        scSubsetRoleIds: string,
        scSupersetRoleIds: string,
      ): string =>
        `Population "${popId}": instance "${instId}" has subset tuple [${subsetKey}] for roles [${scSubsetRoleIds}] with no matching superset tuple in roles [${scSupersetRoleIds}].`,
    },
  },
  [RULE_ID.unaryRoleCardinalityViolation]: {
    severity: "error",
    description:
      "The number of instances playing a unary role falls outside its cardinality bounds.",
    messages: {
      aboveMaximum: (
        cRoleId: string,
        ftName: string,
        count: number,
        cMin: number | "unbounded",
      ): string =>
        `Cardinality constraint on role "${cRoleId}" in fact type "${ftName}" is played by ${count} instance(s) but requires at least ${cMin}.`,
      belowMinimum: (
        cRoleId: string,
        ftName: string,
        count: number,
        cMax: number | "unbounded",
      ): string =>
        `Cardinality constraint on role "${cRoleId}" in fact type "${ftName}" is played by ${count} instance(s) but allows at most ${cMax}.`,
    },
  },
  [RULE_ID.uniquenessViolation]: {
    severity: "error",
    description:
      "Two instances share the values an internal uniqueness constraint requires to be unique.",
    messages: {
      default: (popId: string, instId: string, ucRoleIds: string, firstId: string): string =>
        `Population "${popId}": instance "${instId}" violates internal uniqueness constraint on role(s) [${ucRoleIds}]. Duplicate of instance "${firstId}".`,
    },
  },
  [RULE_ID.valueComparisonViolation]: {
    severity: "error",
    description:
      "An instance's two role values do not stand in the order a value comparison constraint asserts.",
    messages: {
      default: (popId: string, instId: string, a: string, vcOperator: string, b: string): string =>
        `Population "${popId}": instance "${instId}" violates the value-comparison constraint -- "${a}" ${vcOperator} "${b}" is false.`,
    },
  },
  [RULE_ID.valueConstraintViolation]: {
    severity: "error",
    description: "An instance holds a value outside the set or ranges a value constraint permits.",
    messages: {
      default: (
        popId: string,
        instId: string,
        val: string,
        vcRoleId: string,
        vcValues: string,
        rangeNote: string,
      ): string =>
        `Population "${popId}": instance "${instId}" has value "${val}" for role "${vcRoleId}" which is not in the allowed set [${vcValues}]${rangeNote}.`,
    },
  },
  [RULE_ID.entityMappingSourceMissing]: {
    severity: "error",
    description: "An entity mapping references a source entity that its domain does not define.",
    messages: {
      default: (mappingPath: string, sourceRef: string, mappingSourceContext: string): string =>
        `Entity mapping in "${mappingPath}" references source object type "${sourceRef}" which does not exist in domain "${mappingSourceContext}".`,
    },
  },
  [RULE_ID.entityMappingTargetMissing]: {
    severity: "error",
    description: "An entity mapping references a target entity that its domain does not define.",
    messages: {
      default: (mappingPath: string, targetRef: string, mappingTargetContext: string): string =>
        `Entity mapping in "${mappingPath}" references target object type "${targetRef}" which does not exist in domain "${mappingTargetContext}".`,
    },
  },
  [RULE_ID.mappingSourceContextMissing]: {
    severity: "error",
    description: "A context mapping references a source context the project does not contain.",
    messages: {
      default: (mappingPath: string, mappingSourceContext: string): string =>
        `Context mapping "${mappingPath}" references source context "${mappingSourceContext}" which is not a domain in the project.`,
    },
  },
  [RULE_ID.mappingTargetContextMissing]: {
    severity: "error",
    description: "A context mapping references a target context the project does not contain.",
    messages: {
      default: (mappingPath: string, mappingTargetContext: string): string =>
        `Context mapping "${mappingPath}" references target context "${mappingTargetContext}" which is not a domain in the project.`,
    },
  },
  [RULE_ID.productDomainDependencyMissing]: {
    severity: "error",
    description: "A data product depends on a domain the project does not contain.",
    messages: {
      default: (productContext: string, depDomain: string): string =>
        `Data product "${productContext}" depends on domain "${depDomain}" which is not in the project.`,
    },
  },
  [RULE_ID.productMappingDependencyUnresolved]: {
    severity: "warning",
    description: "A data product depends on a context mapping that could not be resolved.",
    messages: {
      default: (productContext: string, depMapping: string): string =>
        `Data product "${productContext}" depends on mapping "${depMapping}" which could not be matched to a mapping in the project.`,
    },
  },
  [RULE_ID.binaryMissingInverseReading]: {
    severity: "warning",
    description:
      "A binary fact type has only one reading, where both a forward and an inverse are expected.",
    messages: {
      default: (ftName: string, ftReadingsLength: number): string =>
        `Binary fact type "${ftName}" has only ${ftReadingsLength} reading. Binary fact types typically have both a forward and inverse reading.`,
    },
  },
  [RULE_ID.danglingRoleReference]: {
    severity: "error",
    description: "A role references an object type that does not exist in the model.",
    messages: {
      default: (roleName: string, ftName: string, rolePlayerId: string): string =>
        `Role "${roleName}" in fact type "${ftName}" references object type id "${rolePlayerId}" which does not exist in the model.`,
    },
  },
  [RULE_ID.duplicateFactTypeName]: {
    severity: "error",
    description: "Two fact types share a name, so any reference to that name is ambiguous.",
    messages: {
      default: (ftName: string, existing: string): string =>
        `Duplicate fact type name "${ftName}". Another fact type with this name already exists (id: ${existing}).`,
    },
  },
  [RULE_ID.duplicateObjectTypeName]: {
    severity: "error",
    description: "Two object types share a name, so any reference to that name is ambiguous.",
    messages: {
      default: (otName: string, existing: string): string =>
        `Duplicate object type name "${otName}". Another object type with this name already exists (id: ${existing}).`,
    },
  },
  [RULE_ID.duplicateObjectification]: {
    severity: "error",
    description: "One fact type is objectified more than once.",
    messages: {
      default: (oftFactTypeId: string): string =>
        `Fact type id "${oftFactTypeId}" is objectified more than once.`,
    },
  },
  [RULE_ID.duplicateObjectificationTarget]: {
    severity: "error",
    description: "One object type serves as the objectification of more than one fact type.",
    messages: {
      default: (oftObjectTypeId: string): string =>
        `Object type id "${oftObjectTypeId}" is used as an objectification target more than once.`,
    },
  },
  [RULE_ID.objectifiedDanglingFactType]: {
    severity: "error",
    description:
      "An objectified fact type references a fact type that does not exist in the model.",
    messages: {
      default: (oftFactTypeId: string): string =>
        `Objectified fact type references fact type id "${oftFactTypeId}" which does not exist in the model.`,
    },
  },
  [RULE_ID.objectifiedDanglingObjectType]: {
    severity: "error",
    description:
      "An objectified fact type references an object type that does not exist in the model.",
    messages: {
      default: (oftObjectTypeId: string): string =>
        `Objectified fact type references object type id "${oftObjectTypeId}" which does not exist in the model.`,
    },
  },
  [RULE_ID.objectifiedNotEntity]: {
    severity: "error",
    description:
      "An objectified fact type names a value type as its entity type; only entity types can be objectifications.",
    messages: {
      default: (objectTypeName: string, objectTypeKind: string): string =>
        `Objectified fact type references "${objectTypeName}" as the entity type, but it is a ${objectTypeKind} type. Only entity types can be objectifications.`,
    },
  },
  [RULE_ID.identificationCycle]: {
    severity: "error",
    description:
      "An object type is identified, directly or transitively, by itself, so no key can be assigned.",
    messages: {
      default: (path: string): string =>
        `Identification cycle: ${path}. An objectifying type is identified by the fact type it `
        + `objectifies, and an identified subtype by its supertype, so a type cannot appear in `
        + `its own identification.`,
    },
  },
  [RULE_ID.subtypeCycle]: {
    severity: "error",
    description: "The subtype hierarchy contains a cycle, so a type would be its own ancestor.",
    messages: {
      default: (): string => `The subtype hierarchy contains a cycle.`,
    },
  },
  [RULE_ID.subtypeDanglingSubtype]: {
    severity: "error",
    description: "A subtype fact references a subtype that does not exist in the model.",
    messages: {
      default: (sfSubtypeId: string): string =>
        `Subtype fact references subtype id "${sfSubtypeId}" which does not exist in the model.`,
    },
  },
  [RULE_ID.subtypeDanglingSupertype]: {
    severity: "error",
    description: "A subtype fact references a supertype that does not exist in the model.",
    messages: {
      default: (sfSupertypeId: string): string =>
        `Subtype fact references supertype id "${sfSupertypeId}" which does not exist in the model.`,
    },
  },
  [RULE_ID.subtypeNotEntity]: {
    severity: "error",
    description:
      "A subtype fact names a value type on one of its sides; only entity types participate in subtyping.",
    messages: {
      subtypeSide: (subtypeName: string, subtypeKind: string): string =>
        `Subtype fact references "${subtypeName}" as subtype, but it is a ${subtypeKind} type. Only entity types can participate in subtype relationships.`,
      supertypeSide: (supertypeName: string, supertypeKind: string): string =>
        `Subtype fact references "${supertypeName}" as supertype, but it is a ${supertypeKind} type. Only entity types can participate in subtype relationships.`,
    },
  },
  [RULE_ID.joinSubsetViolation]: {
    severity: "error",
    description:
      "A tuple projected by a join subset constraint's subset path is absent from its superset path.",
    messages: {
      default: (factTypeName: string, tuple: string): string =>
        `Join subset constraint in fact type "${factTypeName}" is violated: the subset tuple [${tuple}] is not in the superset operand.`,
    },
  },
  [RULE_ID.joinEqualityViolation]: {
    severity: "error",
    description:
      "The tuple sets a join equality constraint compares across its paths are not identical.",
    messages: {
      default: (factTypeName: string, tuple: string): string =>
        `Join equality constraint in fact type "${factTypeName}" is violated: the tuple [${tuple}] is not projected by every operand.`,
    },
  },
  [RULE_ID.joinExclusionViolation]: {
    severity: "error",
    description:
      "A tuple appears in the projected sets of more than one operand of a join exclusion constraint.",
    messages: {
      default: (factTypeName: string, tuple: string): string =>
        `Join exclusion constraint in fact type "${factTypeName}" is violated: the tuple [${tuple}] is projected by more than one operand.`,
    },
  },
  [RULE_ID.ringViolation]: {
    severity: "error",
    description:
      "A population breaks the relational property a ring constraint asserts, such as a self-reference under an irreflexive ring.",
    messages: {
      // The wording is chosen per ring property by `MESSAGES` in
      // population/ring.ts, which builds the whole sentence; it arrives
      // here already rendered rather than being re-derived.
      default: (text: string): string => text,
    },
  },
  [RULE_ID.mergeError]: {
    severity: "error",
    description:
      "A merge could not be completed; the merged model was discarded and the error reported in its place. Not a validation rule.",
    messages: {
      default: (reason: string): string => `Merge failed: ${reason}`,
    },
  },
} as const satisfies Record<string, RuleDescriptor>;

/** Every rule identifier core's validation can emit. */
export type RuleId = (typeof RULE_ID)[keyof typeof RULE_ID];

/** Every rule identifier, in declaration order. */
export const RULE_IDS = Object.keys(RULE_DESCRIPTORS) as readonly RuleId[];

/** The descriptor for a rule identifier. */
export function ruleDescriptor(id: RuleId): RuleDescriptor {
  return RULE_DESCRIPTORS[id];
}

/**
 * Build the `report` pair for a registry.
 *
 * Core calls this for its own rules and exports it so a surface can call
 * it for theirs, rather than copying the two functions. Both halves stay
 * typed against whichever registry they were built from, so a surface
 * cannot name a core rule through its own reporter or vice versa.
 */
export function makeReporter<D extends Record<string, RuleDescriptor>>(descriptors: D) {
  type Id = keyof D & string;
  type Msg<K extends Id> = keyof D[K]["messages"] & string;
  type Args<K extends Id, M extends Msg<K>> = Parameters<
    D[K]["messages"][M] extends (...a: infer A) => string ? (...a: A) => string : never
  >;

  /** A diagnostic carrying the rule's own severity and wording. */
  function report<K extends Id, M extends Msg<K>>(
    id: K,
    messageId: M,
    elementId: string,
    ...args: Args<K, M>
  ) {
    const descriptor: RuleDescriptor = descriptors[id]!;
    const message = descriptor.messages[messageId] as (...a: unknown[]) => string;
    return { severity: descriptor.severity, message: message(...args), elementId, ruleId: id };
  }

  /** As `report`, with the severity the caller computed. */
  function reportAs<K extends Id, M extends Msg<K>>(
    severity: DiagnosticSeverity,
    id: K,
    messageId: M,
    elementId: string,
    ...args: Args<K, M>
  ) {
    return { ...report(id, messageId, elementId, ...args), severity };
  }

  return { report, reportAs };
}

/** Core's own reporters, over the registry above. */
export const { report, reportAs } = makeReporter(RULE_DESCRIPTORS);
