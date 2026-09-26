# A persona can declare any check a format cannot express

Status: Implemented 2026-09-26 -- the single workstream

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-1079

The enterprise trial grades each persona's acceptance rubric over the
model barwise imports from each artifact. Some checks are ones a source
format cannot satisfy by construction. OpenAPI has no ring constraints,
no deontic modality and no composite keys; dbt tests cannot say a
reference must not loop. A persona declares such a check under
`not_expressible` with a reason, and the grader excludes it for that
artifact kind only (barwise-y6a). The entry named a check by its
`element`, which only `requires_element` checks have. So a
`requires_verbalization` or `forbids_population` check could not be
declared: the runner refused the entry, and seven acceptance rows sat
open on format limits mixed with real importer gaps. After this change,
all three gradeable kinds can be declared. The format limits are
declared, and the rows that remain are real gaps with their own issues.

## Principle

**Explicit over implicit.** A format limit is declared on the persona
with its reason, not inferred and not left as an open row that hides
the importer gaps next to it.

## Requirements

- **R1.** A `not_expressible` entry's `check` shall name a rubric check
  by its kind's identity: `requires_element` by `element` (unchanged),
  `requires_verbalization` by `{ sentence }`, `forbids_population` by
  `{ factType, constraint }`. Key order shall not matter.
- **R2.** `must_validate` shall not be declarable.
- **R3.** The existing rules stand: an entry needs a reason and a kind
  the persona judges, and must name exactly one check.
- **R4.** Declare only format limits. A check the format can express
  stays a failing row under an issue that names the gap.

## Scope

In: `trial/lib/personas.mjs` (`checkKey`), `trial/AUTHORING.md`, the
declarations on C01, C07 and C11, and the baseline and catalog rows they
move. Out: the gaps themselves (barwise-nul, barwise-nkn).

## Workstream (single)

Measured over the seven rows barwise-1079 held, on the small tier:

| Row                                                  | Declared (format limit)                             | Left (gap)                           |
| ---------------------------------------------------- | --------------------------------------------------- | ------------------------------------ |
| C01 `clinical-informaticist:fhir-openapi`            | two ternary uniqueness checks, the irreflexive ring | discriminator subtypes (barwise-nul) |
| C07 `catalog-product-manager:tmf-openapi`            | acyclic ring, value-side uniqueness                 | none: the row passes                 |
| C07 `integration-engineer:tmf-openapi`               | composite uniqueness, deontic obligation            | none: the row passes                 |
| C11 `data-platform-lead:metrics-dbt`                 | acyclic ring                                        | none: the row passes                 |
| C03 `actuarial-analyst`, `claims-data-steward` (dbt) | none                                                | all (barwise-nkn)                    |
| C04 `analytics-engineer:warehouse-dbt`               | none                                                | all (barwise-nkn)                    |

Kept as gaps, because dbt can state them: multi-column uniqueness
(`dbt_utils.unique_combination_of_columns`), an obligation (a test with
`severity: warn`), subtypes and relationship roles (separate models and
`relationships` tests), and a ternary from a composite key. The C04
persona says so itself: "the relationships test from orders to buyers
... must come back as a fact type."

Result: `trial:gate --tier small`, 1,070 steps, 0 new, 0 stale, open
rows 198 to 195.

## Risks and testing

- **Declaring away a gap.** This is the risk R4 exists for. Each
  declaration's reason names what the format lacks. The judgement calls
  are the OpenAPI ternaries: OpenAPI can nest the triple as an array of
  objects, but it cannot say which pair is unique, and the checks are
  on that uniqueness.
- Tests: `oracles.test.mjs` names a verbalization and a population
  check, ignores key order, refuses a partial key, and cannot excuse
  `must_validate`. Its real-package test checks that each declaration
  names exactly one check.

## Open decisions

None.
