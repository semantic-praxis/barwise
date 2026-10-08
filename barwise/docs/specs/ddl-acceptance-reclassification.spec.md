# barwise-1077's acceptance rows point at their real causes

Status: Implemented -- the one workstream landed with this spec
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-1077 (closes); barwise-d60 (filed here)

In one sentence: barwise-1077's import fix landed in #594 and #595, but
19 trial-baseline rows still named it as their cause, and a triage of
their 81 failing persona checks found none that is still about the
importer's handling of a composite key -- so the rows are reclassified,
the two causes that were the trial's own are fixed, and the issue
closes.

## Principle

**A baseline row names what it is waiting for.** A row that cites a
fixed issue tells a reader the issue is still open, and the next person
to touch the importer chases a defect that is gone. The rows' own notes
said this would happen: "Checks DDL cannot express keep a row open after
the fix; reclassify it then."

## The triage

Every failing check in the 19 rows, measured on the 2026-10-07 small
tier, by cause:

| Cause                                                      | Checks | Disposition                                       |
| ---------------------------------------------------------- | ------ | ------------------------------------------------- |
| Element missing: a skin renames it, or never states the FK | 44     | barwise-d60 (decision: grader mapping or feature) |
| Deontic rule ("It is obligatory ...")                      | 7      | `not_expressible` for `ddl`                       |
| Ring constraint (acyclic chain)                            | 7      | `not_expressible` for `ddl`                       |
| "The combination of ... is unique across fact types"       | 5      | trial generator now writes the `UNIQUE`           |
| Mandatory or uniqueness the import does not enforce        | 5      | per row, below                                    |
| Subtype verbalization                                      | 2      | barwise-1078, already open                        |
| Objectification wording                                    | 4      | per row, below                                    |

## Scope

In scope:

- **The trial's DDL generator writes a multi-column `UNIQUE`.** When an
  external uniqueness's roles all become columns of one table, that
  table carries `UNIQUE (...)`. The generator wrote none, so the five
  "combination is unique" checks graded artifacts that never stated
  the combination; C09's `SUBJECT` table, for one, had no
  `UNIQUE (STUDY_ID, SITE_ID, SUBJECT_NUMBER)`. A skin can opt out with
  the `no_unique_constraints` idiom.
- **Deontic and ring checks are declared `not_expressible` for `ddl`.**
  Both are limits of the format, which is what AUTHORING.md reserves
  the declaration for: DDL has no deontic modality, and nothing in a
  `CREATE TABLE` forbids a chain of rows that returns to its start.
  Nineteen checks across eleven personas, each with its reason.
- **Each row's `issue` names its remaining cause,** through the
  finding catalog's classes, and the 1077 classes and the
  `trial/findings/barwise-1077` reproduction go: the reproduction is
  covered by `DdlImportFidelity.test.ts` and `DdlRoundTrip.test.ts`.

Out of scope: the naming decision itself (barwise-d60), and fixing any
importer defect the per-row triage turns up; each is filed instead.

## Alternatives considered

- **Declare "combination is unique" `not_expressible`.** Wrong: DDL
  states it with `UNIQUE`. The artifact's generator was the gap.
- **Declare the naming failures `not_expressible`.** Wrong for the same
  reason, and AUTHORING.md forbids using the declaration for anything
  but a format limit.

## Implementation notes

- **Six of the 19 rows now pass** on the regenerated small tier (C02
  regmart, C04 snowflake, C06 tms, C08 billing, C09 clinical data
  manager, C09 pharmacovigilance lead) and are removed from the
  baseline. The gate reads `0 new, 0 stale, 166 open -> PASS`.
- **Eleven point at barwise-d60**, through the existing
  `acceptance-edit-distance-sql` class, re-pointed: every failing check
  left in them is a renamed concept or an unstated relationship.
- **Two point at barwise-2z1, filed here** through a new
  `acceptance-all-role-table` class. The per-row triage found an
  importer gap the first draft did not: a table whose every column is a
  role (C08's meter readings, C09's doses) imports as an entity or as a
  relationship over its foreign keys alone, never as the three-role
  fact type. `trial/findings/barwise-2z1/` reproduces it.
- **A second generator gap surfaced after the first fix:** a table for a
  fact type of three or more roles was keyed on all of them, whatever
  its uniqueness said, which hid C06's "for each Shipment and Leg at
  most one Vehicle" from the artifact. It is keyed on the uniqueness
  now.
- **Copilot's review found two cases the generator must not write:**
  BigQuery has no `UNIQUE` constraint, and a deontic uniqueness (C12's
  Recipient and Program) is an obligation a row may break.
- **The `acceptance-edit-distance-ddl` class is removed**: its rows
  either pass or moved to `acceptance-all-role-table`.
