# A constraint over subtypes is reported by every schema export

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-lwy
Touches: barwise/packages/core/src/mapping/constraintRouting.ts,
barwise/packages/core/src/annotation/constraintSpec.ts,
+barwise/packages/core/src/model/subtypeOperands.ts,
barwise/packages/core/src/model/Constraint.ts,
barwise/packages/core/src/verbalization/constraints/phase2.ts,
barwise/packages/formats/src/ossie/writeOssie.ts,
barwise/docs/specs/ossie-ontology-format.spec.md,
barwise/packages/core/tests/mapping/ConstraintRouting.test.ts,
barwise/packages/core/tests/mapping/unreportedConstraintSpecs.test.ts,
barwise/packages/formats/tests/OssieExportFormat.test.ts,
barwise/docs/specs/schema-export-constraint-specs.spec.md,
barwise/docs/IMPORT_EXPORT.md

When a model holds an exclusion, exclusive-or or disjunctive mandatory
over subtypes ("each Party is at most one of: LegalEntity,
NaturalPerson"), the constraint router shall spill it at the supertype's
table with a reason, and the spec builder shall describe it, so DDL
comments it and the OpenAPI, Avro, dbt and Ossie exports report it.
Today the router returns early for it (`if (isOverSubtypes(c)) return;`):
DDL keeps it only inside the barwise annotation, a DDL export with
annotations off carries it nowhere, and the four other exports neither
carry it nor report it.

## Principle

Explicit over implicit: a constraint is enforced, recorded, or reported,
never silently dropped (`schema-export-constraint-specs.spec.md`). The
router owns "what the schema realized" for every exporter, so the fix is
one more case in it, and the three schema exports report the result
through `unreportedConstraintSpecs` without a change of their own. The
annotation stays as it is, since it is what lets the DDL importer read
the constraint back.

## Observed today (at ff3343ba)

- The mapper gives every entity its own table, and a subtype's table
  carries a foreign key to its supertype's (`RelationalMapper`, rule 8
  and `addSubtypeForeignKey`). An exclusion over subtypes says that no
  supertype key appears in more than one subtype table, and a
  disjunctive mandatory that every supertype key appears in at least one.
  Both span tables, so no UNIQUE or CHECK clause states them.
- `buildConstraintSpec`'s header says a constraint over subtypes "is not
  passed here", and its pseudocode labels roles, which these do not
  have. The verbalizer already handles them ("Each Encounter is exactly
  one of: InpatientEncounter, OutpatientEncounter, EmergencyEncounter.").
  The counterexample generator returns nothing for them, and the builder
  falls back to "No concrete example available".
- `writeOssie` lists each one in its loss report but builds no spec,
  because its guard skips a constraint over subtypes. The guard's other
  exclusion, a constraint with no roles, is one the builder already
  describes.
- The verbalizer decides which supertype a constraint over subtypes is
  about (that of the first subtype fact that resolves) and the quantity
  each kind means (`verbalizeSubtypeConstraint`, `phase2.ts`). The
  router and the spec builder need the same two decisions.
- Over every tracked `.orm.yaml`, 14 such constraints in 10 files: 8
  exclusions and 6 exclusive-ors.

## Scope

- When the router meets a constraint over subtypes, it shall spill it
  with the reason "a rule over subtypes spans their tables, which no
  clause can state", at the supertype's table.
- When `buildConstraintSpec` builds a spec for one, its pseudocode shall
  read "every instance of S is an instance of Q of: A, B", with Q "at most
  one" for an exclusion, "exactly one" for an exclusive-or, and "at least
  one" for a disjunctive mandatory. Pseudocode is written over the model
  for every kind, never the schema, so it names the types, not the
  subtype tables.
- The supertype and the quantity shall be decided once, in
  `model/subtypeOperands.ts`, and read by the verbalizer, the spec
  builder and the router. When no subtype fact resolves, the pseudocode
  says "the supertype", as the verbalization does. `isOverSubtypes`
  becomes a type guard, so a reader of `subtypeFactIds` needs no cast.
- When the Ossie exporter loses a constraint, it shall add its spec,
  with no guard: the builder now describes every constraint.
- The barwise annotation and the DDL import are unchanged; no non-comment
  line of any DDL changes.

Out of scope: enforcing these rules (an assertion or trigger across
subtype tables, a dbt test); NORMA, which writes them natively with the
subtype facts (`NormaXmlWriter`); and a counterexample, which the
generator does not produce for these, so each spec carries "No concrete
example available" (barwise-j7j). A model whose subtype facts name
different supertypes fails validation; its spill names the first
supertype.

## Workstreams

### 1. Router, spec builder and Ossie

The three changes above, one commit, since the router and the Ossie
writer both need the spec builder to accept the constraint. Acceptance,
each pinned by a test asserting the exact value: the router spills an
exclusion over subtypes at the supertype's table, with the reason and the
pseudocode; the pseudocode of an exclusive-or and of a one-subtype
disjunctive mandatory; `unreportedConstraintSpecs` reports one; the Ossie
export of a model with one returns its spec beside the loss line;
`schema-export-constraint-specs.spec.md`, `IMPORT_EXPORT.md`,
`ossie-ontology-format.spec.md` and `writeOssie`'s header stop saying it
goes unreported; Status moves to Implemented in the commit that lands it;
the corpus effect is recorded here.

## Open decisions

1. **Where the spill sits.** (a) The supertype's table (recommended): the
   rule is about the supertype's instances, and every subtype table's key
   references it. (b) No table: the comment would go at the top of the
   DDL, away from every table it concerns. Recommend (a).
2. **Ossie in this change.** (a) Yes (recommended): it lists the loss
   already and lacks only the spec, which this change makes buildable;
   leaving it out keeps a guard whose reason is gone. (b) A separate
   change: smaller here, and the guard keeps saying something untrue.
   Recommend (a), removing the guard outright.

## Risks and testing

Measured on a prototype over every tracked `.orm.yaml`, comparing every
dialect with and without annotations, and Ossie: 170 of 1,428 rows change,
in the 10 files, gaining 224 lines, all comments; no other line changes.
Postgres DDL and Ossie each gain 14 specs; the OpenAPI, Avro and dbt
reports grow from 443 to 457 specs, in the same 55 of 84 models. No
existing test changes. A DDL with annotations on now states each rule
twice, in the annotation and in a comment; the annotation is for the
importer and the comment for a reader, as for every other spill.
