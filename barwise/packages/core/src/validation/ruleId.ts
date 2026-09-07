/**
 * The closed set of rule identifiers core's validation emits, each with
 * the metadata a reader (or a report) needs to make sense of it.
 *
 * Two things follow from the shape rather than the contents. The
 * `Record` is the completeness idiom `RING_TYPE_MEMBERS` established
 * (barwise-869): the union is derived from it, so a rule id used in a
 * rule module but missing here is a compile error, and the runtime list
 * cannot lag the union. And the value is a descriptor rather than
 * `true`, so a rule cannot be registered without being described --
 * which is what makes these rows worth writing rather than ceremony
 * (`docs/specs/closed-sets-as-unions.spec.md`, WS2).
 *
 * The descriptor is deliberately a subset of SARIF's
 * `reportingDescriptor`, so a future exporter (barwise-948) reads this
 * table rather than maintaining a second one. It stops at the subset
 * barwise can honestly fill: no `helpUri`, because there is no rule
 * documentation to point at yet, and `severity` in barwise's own
 * vocabulary rather than SARIF's `level`, because core should not name
 * an interchange format it does not emit. Mapping `info` to SARIF's
 * `note` is the exporter's job.
 *
 * `severity` is the default, not a guarantee: a constraint's deontic
 * modality lowers a violation from `error` to `warning` at report time
 * (`severityForModality`), and `constraint/spanning-all-roles` reports
 * `info` on a binary fact type. SARIF draws the same distinction
 * between `defaultConfiguration.level` and a result's own `level`.
 *
 * A surface that mints identifiers of its own declares its own registry
 * of this shape and composes at the point of use; core does not learn
 * about it. See `Diagnostic`'s type parameter.
 */

import type { DiagnosticSeverity } from "./severity.js";

/** What a rule reports, and how loudly, before modality is applied. */
export interface RuleDescriptor {
  /** The severity this rule reports unless modality or arity lowers it. */
  readonly severity: DiagnosticSeverity;
  /** One sentence naming the condition that triggers the rule. */
  readonly description: string;
}

const RULE_DESCRIPTORS = {
  "completeness/fact-type-without-constraints": {
    severity: "warning",
    description:
      "A fact type carries no constraints at all, so nothing about its population is asserted.",
  },
  "completeness/fact-type-without-uniqueness": {
    severity: "warning",
    description:
      "A fact type has constraints but no internal uniqueness, so no combination of its roles is identified.",
  },
  "completeness/isolated-object-type": {
    severity: "info",
    description: "An object type plays no role in any fact type.",
  },
  "completeness/missing-object-type-definition": {
    severity: "info",
    description: "An object type has no natural-language definition.",
  },
  "completeness/missing-preferred-identifier": {
    severity: "info",
    description: "An entity type has no uniqueness constraint marked as its preferred identifier.",
  },
  "completeness/missing-value-type-data-type": {
    severity: "info",
    description: "A value type declares no conceptual data type.",
  },
  "completeness/multiple-preferred-identifiers": {
    severity: "warning",
    description: "An entity type has more than one uniqueness constraint marked preferred.",
  },
  "constraint/cardinality-invalid-role": {
    severity: "error",
    description: "A cardinality constraint names a role that does not belong to its fact type.",
  },
  "constraint/cardinality-max-less-than-min": {
    severity: "error",
    description:
      "A cardinality constraint's maximum is below its minimum, so no population can satisfy it.",
  },
  "constraint/cardinality-non-unary": {
    severity: "error",
    description: "A cardinality constraint is attached to a role of a fact type that is not unary.",
  },
  "constraint/disjunctive-mandatory-too-few-roles": {
    severity: "error",
    description: "A disjunctive mandatory constraint spans fewer than two roles.",
  },
  "constraint/equality-arity-mismatch": {
    severity: "error",
    description: "An equality constraint compares two role sequences of different lengths.",
  },
  "constraint/exclusion-too-few-roles": {
    severity: "error",
    description: "An exclusion constraint spans fewer than two roles.",
  },
  "constraint/exclusive-or-too-few-roles": {
    severity: "error",
    description: "An exclusive-or constraint spans fewer than two roles.",
  },
  "constraint/external-uniqueness-all-local": {
    severity: "warning",
    description:
      "An external uniqueness constraint spans roles that all belong to one fact type, where an internal one would say the same thing.",
  },
  "constraint/frequency-empty-roles": {
    severity: "error",
    description: "A frequency constraint names no roles.",
  },
  "constraint/frequency-invalid-min": {
    severity: "error",
    description:
      "A frequency constraint's minimum is below one; a frequency counts only the instances that do play the role, so a lower bound excludes nothing.",
  },
  "constraint/frequency-invalid-role": {
    severity: "error",
    description: "A frequency constraint names a role that does not belong to its fact type.",
  },
  "constraint/frequency-max-less-than-min": {
    severity: "error",
    description:
      "A frequency constraint's maximum is below its minimum, so no population can satisfy it.",
  },
  "constraint/internal-uniqueness-invalid-role": {
    severity: "error",
    description:
      "An internal uniqueness constraint names a role that does not belong to its fact type.",
  },
  "constraint/join-arity-mismatch": {
    severity: "error",
    description:
      "A join constraint's operands project tuples of different lengths, so they cannot be compared.",
  },
  "constraint/join-bad-projection": {
    severity: "error",
    description: "A join constraint projects a path node that does not exist on the path.",
  },
  "constraint/join-bad-step": {
    severity: "error",
    description:
      "A join constraint has a step whose entry and exit roles do not share a fact type.",
  },
  "constraint/join-column-type-mismatch": {
    severity: "error",
    description: "A join constraint compares two projected columns whose object types differ.",
  },
  "constraint/join-discontiguous": {
    severity: "error",
    description:
      "A join constraint's path is not contiguous: a step does not start where the previous one ended.",
  },
  "constraint/join-empty-projection": {
    severity: "error",
    description: "A join constraint has an operand that projects no nodes.",
  },
  "constraint/join-too-few-operands": {
    severity: "error",
    description: "A join equality or exclusion constraint has fewer than two operands.",
  },
  "constraint/join-unknown-root": {
    severity: "error",
    description:
      "A join constraint's path is rooted at an object type that does not exist in the model.",
  },
  "constraint/mandatory-invalid-role": {
    severity: "error",
    description: "A mandatory constraint names a role that does not belong to its fact type.",
  },
  "constraint/ring-different-players": {
    severity: "error",
    description: "A ring constraint relates two roles played by different object types.",
  },
  "constraint/ring-invalid-role": {
    severity: "error",
    description: "A ring constraint names a role that does not belong to its fact type.",
  },
  "constraint/spanning-all-roles": {
    severity: "warning",
    description:
      "An internal uniqueness constraint spans every role of its fact type, which permits duplicate tuples rather than identifying any.",
  },
  "constraint/subset-arity-mismatch": {
    severity: "error",
    description: "A subset constraint compares two role sequences of different lengths.",
  },
  "constraint/value-comparison-invalid-role": {
    severity: "error",
    description:
      "A value comparison constraint names a role that does not belong to its fact type.",
  },
  "constraint/value-constraint-invalid-role": {
    severity: "error",
    description: "A value constraint names a role that does not belong to its fact type.",
  },
  "derivation/derived-with-population": {
    severity: "warning",
    description:
      "A purely derived fact type carries a stored population, which its rule would compute.",
  },
  "derivation/missing-rule": {
    severity: "warning",
    description: "A fact type is marked derived or semiderived but carries no derivation rule.",
  },
  "merge-error": {
    severity: "error",
    description:
      "A merge could not be completed; the merged model was discarded and the error reported in its place. Not a validation rule.",
  },
  "population/dangling-fact-type": {
    severity: "error",
    description: "A population references a fact type that does not exist in the model.",
  },
  "population/disjunctive-mandatory-violation": {
    severity: "error",
    description:
      "An object instance plays none of the roles a disjunctive mandatory constraint requires at least one of.",
  },
  "population/equality-violation": {
    severity: "error",
    description: "A tuple appears in one side of an equality constraint and not the other.",
  },
  "population/exclusion-violation": {
    severity: "error",
    description:
      "An object instance plays more than one of the roles an exclusion constraint forbids combining.",
  },
  "population/exclusive-or-violation": {
    severity: "error",
    description:
      "An object instance plays none of the roles an exclusive-or constraint requires exactly one of.",
  },
  "population/external-uniqueness-violation": {
    severity: "error",
    description:
      "Two instances share the values an external uniqueness constraint requires to identify at most one.",
  },
  "population/frequency-violation": {
    severity: "error",
    description:
      "A value or value combination occurs a number of times outside a frequency constraint's bounds.",
  },
  "population/incomplete-instance": {
    severity: "error",
    description: "A population instance leaves one or more of its fact type's roles unfilled.",
  },
  "population/mandatory-violation": {
    severity: "error",
    description:
      "An object instance in the model's universe does not play a role a mandatory constraint requires.",
  },
  "population/object-cardinality-violation": {
    severity: "error",
    description: "An object type's population size falls outside its declared cardinality bounds.",
  },
  "population/subset-violation": {
    severity: "error",
    description:
      "A tuple appears in a subset constraint's subset side without appearing in its superset side.",
  },
  "population/unary-role-cardinality-violation": {
    severity: "error",
    description:
      "The number of instances playing a unary role falls outside its cardinality bounds.",
  },
  "population/uniqueness-violation": {
    severity: "error",
    description:
      "Two instances share the values an internal uniqueness constraint requires to be unique.",
  },
  "population/value-comparison-violation": {
    severity: "error",
    description:
      "An instance's two role values do not stand in the order a value comparison constraint asserts.",
  },
  "population/value-constraint-violation": {
    severity: "error",
    description: "An instance holds a value outside the set or ranges a value constraint permits.",
  },
  "population/join-equality-violation": {
    severity: "error",
    description:
      "The tuple sets a join equality constraint compares across its paths are not identical.",
  },
  "population/join-exclusion-violation": {
    severity: "error",
    description:
      "A tuple appears in the projected sets of more than one operand of a join exclusion constraint.",
  },
  "population/join-subset-violation": {
    severity: "error",
    description:
      "A tuple projected by a join subset constraint's subset path is absent from its superset path.",
  },
  "population/ring-violation": {
    severity: "error",
    description:
      "A population breaks the relational property a ring constraint asserts, such as a self-reference under an irreflexive ring.",
  },
  "project/entity-mapping-source-missing": {
    severity: "error",
    description: "An entity mapping references a source entity that its domain does not define.",
  },
  "project/entity-mapping-target-missing": {
    severity: "error",
    description: "An entity mapping references a target entity that its domain does not define.",
  },
  "project/mapping-source-context-missing": {
    severity: "error",
    description: "A context mapping references a source context the project does not contain.",
  },
  "project/mapping-target-context-missing": {
    severity: "error",
    description: "A context mapping references a target context the project does not contain.",
  },
  "project/product-domain-dependency-missing": {
    severity: "error",
    description: "A data product depends on a domain the project does not contain.",
  },
  "project/product-mapping-dependency-unresolved": {
    severity: "warning",
    description: "A data product depends on a context mapping that could not be resolved.",
  },
  "structural/binary-missing-inverse-reading": {
    severity: "warning",
    description:
      "A binary fact type has only one reading, where both a forward and an inverse are expected.",
  },
  "structural/dangling-role-reference": {
    severity: "error",
    description: "A role references an object type that does not exist in the model.",
  },
  "structural/duplicate-fact-type-name": {
    severity: "error",
    description: "Two fact types share a name, so any reference to that name is ambiguous.",
  },
  "structural/duplicate-object-type-name": {
    severity: "error",
    description: "Two object types share a name, so any reference to that name is ambiguous.",
  },
  "structural/duplicate-objectification": {
    severity: "error",
    description: "One fact type is objectified more than once.",
  },
  "structural/duplicate-objectification-target": {
    severity: "error",
    description: "One object type serves as the objectification of more than one fact type.",
  },
  "structural/objectified-dangling-fact-type": {
    severity: "error",
    description:
      "An objectified fact type references a fact type that does not exist in the model.",
  },
  "structural/objectified-dangling-object-type": {
    severity: "error",
    description:
      "An objectified fact type references an object type that does not exist in the model.",
  },
  "structural/objectified-not-entity": {
    severity: "error",
    description:
      "An objectified fact type names a value type as its entity type; only entity types can be objectifications.",
  },
  "structural/subtype-cycle": {
    severity: "error",
    description: "The subtype hierarchy contains a cycle, so a type would be its own ancestor.",
  },
  "structural/subtype-dangling-subtype": {
    severity: "error",
    description: "A subtype fact references a subtype that does not exist in the model.",
  },
  "structural/subtype-dangling-supertype": {
    severity: "error",
    description: "A subtype fact references a supertype that does not exist in the model.",
  },
  "structural/subtype-not-entity": {
    severity: "error",
    description:
      "A subtype fact names a value type on one of its sides; only entity types participate in subtyping.",
  },
} as const satisfies Record<string, RuleDescriptor>;

/** Every rule identifier core's validation can emit. */
export type RuleId = keyof typeof RULE_DESCRIPTORS;

/** Every rule identifier, in declaration order. */
export const RULE_IDS = Object.keys(RULE_DESCRIPTORS) as readonly RuleId[];

/** The descriptor for a rule identifier. */
export function ruleDescriptor(id: RuleId): RuleDescriptor {
  return RULE_DESCRIPTORS[id];
}
