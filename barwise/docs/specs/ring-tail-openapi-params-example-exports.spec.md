# Ring sentences keep a reading's tail, OpenAPI path parameters are valid, example exports cannot drift

Status: Implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-7tx, barwise-9g3, barwise-om4
Plan-reviewed: 5ab23120 (code-review, pr-review)
Touches: barwise/packages/core/src/verbalization/constraints/sentence.ts,
barwise/packages/core/src/verbalization/constraints/phase2.ts,
barwise/packages/core/src/mapping/renderers/openapi.ts,
barwise/packages/core/src/mapping/renderers/avro.ts,
+barwise/packages/core/src/mapping/renderers/names.ts,
barwise/packages/core/src/mapping/index.ts,
barwise/packages/formats/src/avro/,
barwise/packages/formats/tests/,
barwise/docs/specs/dbt-composite-key-tests.spec.md,
barwise/packages/core/tests/,
barwise/packages/cli/tests/characterization/,
barwise/examples/transcripts/,
barwise/docs/release-notes/unreleased.md

This PR fixes three small defects in the verbalizer and exporter output.
They ship together because the third one records output the first two
change.

- A ring constraint's sentence shall keep the reading text after its
  second placeholder.
- An OpenAPI item path shall name each parameter with a valid template
  variable.
- The three unchecked example exports under `examples/transcripts/`
  shall be replaced by checked goldens, so nothing derived from the
  exporters sits in the repository without a check.

## Principle

Two principles apply: define errors out of existence, and determinism in
core, checked rather than asserted.

The exporters are pure, so a committed export is a derived file. A
derived file with no check drifts. These three were last regenerated at
d077c863, then edited by hand (barwise-lqj), and today differ widely
from what the exporter writes:

| File                               | Lines added | Lines removed |
| ---------------------------------- | ----------- | ------------- |
| `clinic-appointments.openapi.json` | 57          | 118           |
| `pii-redaction.openapi.json`       | 266         | 181           |
| `pii-redaction.sql`                | 127         | 21            |

The repository already has a check for exactly this: the CLI
characterization goldens (`cli/tests/characterization/golden.test.ts`).
They record each export, regenerate under `UPDATE_GOLDEN=1`, and check
the format's validity on both paths (barwise-961). The
`clinic-appointments` OpenAPI golden is already the current export of
the same model. A second copy guarded by a second harness would mean
two regenerations for every exporter change, kept in step by hand.

## Observed today (at 7e84074c)

- barwise-7tx. `verbalizeRing` (phase2.ts) builds every ring sentence
  from `extractPredicate`, which keeps only the text between the two
  placeholders. So a ring constraint over a reading such as "{0}
  specializes {1} as supertype" verbalizes as "No EntityNode specializes
  that same EntityNode." The binary mandatory, uniqueness and frequency
  sentences had the same defect, fixed by barwise-m1c
  (binary-constraint-sentences.spec.md), which now render from the
  reading's parts (`eachReading`). The ring sentence is the one caller
  of the slice left. No tracked model has a ring constraint over such a
  reading today.
- barwise-9g3. `renderOpenApi` writes each key column into the item
  path as `{name}`, and uses the same string as the parameter's `name`.
  The current export of `pii-redaction.orm.yaml` has
  `/finding/{(ambiguous)}`, from a reference mode the transcript left
  ambiguous. RFC 6570, which OpenAPI path templating follows, allows a
  variable name only letters, digits, `_` and percent-encoding, with
  single dots between them. Client generators reject or mangle anything
  else.
- barwise-om4. Nothing regenerates or checks the three files, and no
  document links to them. The `.sql` file declares `document_id` twice.

## Scope

### The ring sentence renders the whole reading (barwise-7tx)

- The ring clause shall render the reading's parts after the subject
  placeholder, as `eachReading` does.
  - The object placeholder is written as the clause's determiner, the
    lead, then the name.
  - A repeated placeholder is written as its role's name again.
  - A word after a placeholder is spaced; punctuation flush against the
    placeholder is not.
  - Trailing whitespace and a trailing period are dropped, since the
    sentence writes its own ending.
  - Text before the subject placeholder is dropped, since "No" or "If"
    takes its place.
- "does not" goes between the subject and the rest, where it goes
  today.
- The fallback is kept. When no reading names the subject role before
  the object role, the first reading is used by placeholder position,
  as today: its first placeholder is the subject and its second the
  object.
- `Predicate`'s `text` slice, and `extractPredicate`, go away with
  their one caller.
- Out of scope: the negated clause's verb ("does not is parent of") is
  barwise-gzk.

### OpenAPI path parameters are valid template variables (barwise-9g3)

- A key column whose name is already a valid template variable keeps
  it.
- Any other key column maps to its name with each character outside
  `[A-Za-z0-9_]` replaced by `_`: `(ambiguous)` becomes `_ambiguous_`.
- A mapped name that is taken gets `_2`, `_3`, and so on. A name is
  taken if it is any column of the table, or a parameter already
  assigned. Valid key names are assigned first, so a mapped name never
  takes the name of another column.
- The path and the operations' `parameters` shall use the assigned
  name, from the one list they already share. A renamed parameter
  carries a `description` naming its column, so the export says what it
  renamed.

### Example exports cannot drift (barwise-om4)

- The characterization goldens shall add `pii-redaction.orm.yaml` to
  `MODELS`. Every export format is then recorded and format-checked for
  it, as for `clinic-appointments`.
- The three files under `examples/transcripts/` shall be deleted. Their
  checked equivalents are the goldens, which the CLI writes to stdout
  exactly as a user's `barwise export` does.

### Checks

- Core unit tests pin:
  - a ring sentence over a reading with a tail, for a sentence that
    renders the clause once and one that renders it several times;
  - a tail with flush punctuation, and one with a repeated placeholder;
  - the fallback reading order;
  - every existing ring sentence, unchanged;
  - a key column with parentheses;
  - two key columns that map to one name;
  - a mapped name that equals another column's name.
- The goldens record `pii-redaction` and pass the format checks.
- The release note names the two output changes.

## Open decisions

1. Delete the three example exports, or keep them as checked copies?
   Recommended: delete them. A kept copy needs its own drift test, its
   own regeneration command, a generated mark and a review-tiers row.
   It would also hold the same bytes as a golden, and each exporter
   change would have to update both. The cost of deleting is that a
   reader browsing `examples/transcripts/` no longer sees an export
   beside the transcript. `barwise export` produces one, and the
   goldens hold the recorded output.

## Implementation notes

- Changed scope: the Avro export had the same defect. Adding
  `pii-redaction` to the goldens ran the Avro format check over it, and
  six field names such as `(ambiguous)` were illegal. The Avro renderer
  now renames a field the same way, under Avro's stricter rule (no dots,
  no leading digit), with the field's `doc` naming the column. The
  implementation review found that the exporter matched column
  annotations by field name, so a renamed field lost its notes; it now
  maps each column to its field.
- One core module (`mapping/renderers/names.ts`) owns the Avro name rule,
  its repair and the renaming loop the OpenAPI parameters also use.
  Formats' namespace check (`avroNames.ts`) reads the same rule, which
  it used to hold a copy of.
- The fallback ring reading keeps each lead with the name in its slot.
  The old slice kept only the object's lead, in the predicate text.
- A reading's extra whitespace, and whitespace before its closing period,
  no longer reach the sentence (implementation review).
- `ringClause` keeps its own spacing rather than sharing
  `quantifiedReading`'s: that one writes "that" before a repeated
  placeholder, which a ring sentence must not.
- `dbt-composite-key-tests.spec.md` named two of the deleted files in its
  Touches, which `check:spec-touches` refused. It now names their
  directory.
- Red checks: the new ring tests fail on the slicing renderer, and the
  renamed-field annotation test fails on the exporter without the
  column map.

## Risks and testing

- A ring sentence over a reading with text outside its placeholders
  reads differently. No golden or tracked model holds one.
- An OpenAPI export with a key column outside the variable alphabet
  changes its path. A client generated from the old path was already
  broken. Valid names do not change.
