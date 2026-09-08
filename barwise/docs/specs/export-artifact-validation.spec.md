# A recorded export is checked against the last one, never against its own format

Status: Implemented (one workstream; the second was measured away -- see Implementation notes)
Created: 2026-09-08
Last-updated: 2026-09-08
Tracking: barwise-964 (this spec); barwise-961, whose three invalid
goldens are the evidence

In one sentence: the golden test proves an export has not changed and
proves nothing about whether it is a valid DDL, Avro or OpenAPI
document, so three invalid goldens were green for as long as they
existed -- and one of them was green while silently dropping a column.

## Principle

**Define errors out of existence**, pointed at the recorded artifact.

`checkGolden` compares a string to a file and, under `UPDATE_GOLDEN=1`,
writes whatever it is handed
(`packages/cli/tests/characterization/golden.test.ts:29-40`). Both
halves are pure comparison. Nothing in either asks whether the bytes
are an instance of the format the filename claims, so an invalid
document can be recorded and then defended by the very test a reader
takes as evidence that exports work.

Three were, until PR #456 regenerated them (barwise-961):

- `clinic-appointments.ddl.txt` declared `medical_record_number` twice
  inside one `CREATE TABLE`, and did the same for `provider_id` and
  `confirmation_number` in two more tables. `CREATE TABLE` rejects it.
- `clinic-appointments.avro.txt` had two record fields of one name.
  Avro rejects it.
- `clinic-appointments.openapi.txt` had two properties on one JSON key.
  That one does not fail at all: the second silently replaced the
  first, so a column vanished from the schema and the file stayed well
  formed.

The third is why this is worth a spec rather than a nit. A gate that
cannot see a lost property is not checking what its reader believes it
checks.

## What has already changed since the finding was filed (resolved: the cause is guarded, the artifact is not)

The defect that produced all three is now caught at its source, and
this spec does not re-catch it.

All three shapes came from the mapper emitting a table with two columns
of one name (barwise-961). `mapper.law.test.ts` now asserts per-table
column-name uniqueness over 250 generated models --
`expect(owned.size).toBe(columnNames.length)`, in `expectWellFormed` --
so a schema with a duplicate column fails in `@barwise/core` before any
renderer sees it.

What remains unguarded is everything downstream of a valid schema: a
renderer that emits an invalid document from a valid schema, a golden
recorded from a broken build, a golden edited by hand. The issue's
original framing -- "assert no duplicate name across every golden" --
would today re-state a law that already holds one layer up. The
requirement worth writing is the one the issue's title states: a
recorded export is parsed as an instance of the format it claims.

## A real SQL parser does not catch this (resolved: measured, and dropped)

The issue's design proposed parsing the DDL through the sqlglot tier
already in the project's dependency groups. Measured against the built
bridge, that does not work: `parseSqlWithSqlglot` accepts

```sql
CREATE TABLE t (a VARCHAR(10) NOT NULL, a VARCHAR(10) NOT NULL, PRIMARY KEY (a));
```

as one statement with no errors, and returns `undefined` only for text
that is not parseable SQL at all -- a `CREATE TABLE` cut off mid-body.
sqlglot is a parser, not a validator: it has no reason to reject a
table a database would. So the DDL half of the check is structural
whatever machinery is available, and the workstream that would have
added a sqlglot call to `DdlExportFormat.test.ts` buys only the
malformed-statement class, which the structural check covers directly.
Dropped rather than deferred.

## Parsing is not the check either (resolved: the check must walk raw text)

`JSON.parse` accepts duplicate keys and keeps the last, which is the
exact mechanism by which the OpenAPI golden lost a column. So "parse
it" is not sufficient, and this is not hypothetical: the OpenAPI export
test already calls `JSON.parse` on rendered output at eight sites and
the Avro export test at two
(`packages/formats/tests/OpenApiExportFormat.test.ts`,
`AvroExportFormat.test.ts`). Both suites were green throughout the life
of the invalid goldens.

A duplicate-key check therefore has to see the text, not the parsed
value: either a raw scan or a reviver that counts keys before the
object is built. That is the one non-obvious requirement in this spec,
and it is the reason "we already parse the JSON" is not an answer.

## Scope

In scope, stated as requirements:

- When the golden test compares an export golden, the system shall also
  check that golden is a well-formed instance of the format its
  filename claims, and fail naming the format when it is not.
- When a JSON document under check contains two members of the same key
  within one object, the system shall fail rather than accept the last.
- When an Avro record under check declares two fields of the same name,
  or a name that is not a legal Avro name, the system shall fail.
- When a rendered `CREATE TABLE` under check declares two columns of
  the same name, the system shall fail.
- When `UPDATE_GOLDEN=1` records a golden, the system shall run the
  same checks against what it recorded and fail rather than write an
  invalid file.
  Out of scope: parsing the DDL with sqlglot, which was in this spec's
  first draft and was measured away (see the resolved section below); the mapper invariants (guarded, above); the verbalize and
  validate goldens, which are prose with no format to check; the diagram
  output, which is already checked structurally rather than by golden;
  adding a new dependency for any of these.

## Inventory

| Module                                               | Current state                                                           | Verdict                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| `packages/cli/tests/characterization/golden.test.ts` | `checkGolden` compares strings; `UPDATE_GOLDEN=1` writes anything       | gains format validation on both paths (WS1)            |
| `packages/cli/tests/characterization/golden/`        | 9 export goldens (3 models x ddl/openapi/avro), all currently valid     | untouched; the models and their output do not change   |
| `packages/formats/tests/DdlExportFormat.test.ts`     | asserts with `toContain` substrings only; nothing parses the DDL        | untouched; a parse does not catch this class           |
| `packages/formats/src/sql/SqlglotBridge.ts`          | `parseSqlWithSqlglot`, `sqlglotAvailable`; hard-required in CI          | untouched; measured, and it accepts a duplicate column |
| `packages/core/tests/laws/mapper.law.test.ts`        | `expectWellFormed` asserts per-table column-name uniqueness, 250 models | untouched; it is why WS1 is not about duplicates alone |
| `packages/core/src/mapping/renderers/`               | `ddl.ts`, `avro.ts`, `openapi.ts` render from one `RelationalSchema`    | untouched; this spec adds no renderer change           |

The `untouched` rows are claims, not omissions. The goldens do not
change because the three models and the renderers do not change: WS1
adds a check that the current files already pass, which is exactly the
state in which a new gate is worth landing. `mapper.law.test.ts` is
listed because its existence is what narrows this spec's scope.

## Target architecture

One validator per format, applied at the two points a golden's content
is decided:

```ts
/** The formats a golden's filename can claim; anything else is prose. */
type CheckedFormat = "ddl" | "openapi" | "avro";

/** Empty when the text is a well-formed instance; one entry per defect. */
function formatDefects(format: CheckedFormat, text: string): readonly string[];

function checkGolden(name: string, actual: string): void {
  // ... normalize, then on BOTH the compare path and the UPDATE path:
  //   const format = claimedFormat(name);
  //   if (format) expect(formatDefects(format, text)).toEqual([]);
}
```

Two properties matter. The validator returns defects rather than
throwing, so a failure names every problem in the document rather than
the first. And it runs on the `UPDATE_GOLDEN=1` path as well as the
compare path -- otherwise regeneration is a laundering step, which is
literally how the three invalid files came to be recorded.

`claimedFormat` reads the format out of the filename, which is the same
string the test used to build it (`${m.id}.${fmt}.txt`). That is a
derivation, not a second list: a format added to `EXPORT_FORMATS` with
no validator is a case the switch must handle, and the union type is
what makes that a compile error rather than a silent skip.

## Alternatives considered

- **Assert no duplicate names across every golden, and stop.** The
  issue's own cheap first cut. It was the right call when filed and is
  now redundant with the mapper law for the only cause anyone has seen,
  while still missing a malformed or truncated file.
- **Validate the renderers instead of the goldens.** The formats suite
  runs its own small fixtures, so a defect that only appears on
  `clinic-appointments` is invisible there. The golden test is where the
  three realistic models are already rendered nine ways.
- **Export `parseSqlWithSqlglot` from `@barwise/formats` and use it in
  the cli golden test.** Widens a package's public API for a test's
  convenience, and puts a Python subprocess in the middle of the CLI
  characterization suite. Rejected; see the open decision.
- **Add an OpenAPI or Avro schema validator dependency.** Both formats'
  real rules are far wider than what is at stake, and the repo's rule
  is no dependency for what the language provides. A duplicate-key scan
  and Avro's name rules are a few lines each.

## Workstream: a golden is validated as an instance of its format

One workstream, because there is one change: add `formatDefects` and
wire it into `checkGolden` on both the compare and the record path. DDL
is checked structurally -- column names within each `CREATE TABLE`, and
statements that terminate -- rather than parsed, for the reason
measured above.

Acceptance, in EARS form: when a golden containing a duplicate column,
Avro field, or JSON property name is compared, the golden test shall
fail naming the format and the repeated name; and when the same content
is written under `UPDATE_GOLDEN=1`, the test shall fail rather than
record it. Verified by planting each of the three shapes from
barwise-961 in a copy of the golden, watching the test go red, and
removing it to watch it pass -- three plants, each read red before
green.

## API and migration impact

- No package API changes: the workstream is test-only. In particular,
  `parseSqlWithSqlglot` stays unexported from `@barwise/formats`.
- No golden content changes. Every current golden passes the new
  checks; a run that produced a different file would be a defect this
  spec exists to catch.
- `UPDATE_GOLDEN=1` can now fail. That is the point, and it is a
  behaviour change for anyone regenerating goldens.

## Decisions (resolved)

- **The DDL golden is checked structurally, not parsed.** The
  alternative -- export `parseSqlWithSqlglot` from `@barwise/formats`
  and call it from the cli test -- would widen a package's public API
  for a test's convenience and put a Python subprocess in the CLI
  characterization suite, and the measurement above says it would not
  catch the defect anyway. The structural check reads each `CREATE
  TABLE`'s column names and counts terminated statements, so the
  malformed case a parse would have caught is covered directly.
- **The check runs on the `UPDATE_GOLDEN=1` path too.** Regeneration is
  how the three invalid files came to be recorded; a refresh that can
  write a document no run can parse is the hole, not the fix.
- **The recorded file is checked before the diff, not after.** A golden
  that is an invalid document should fail as one. Left until after the
  comparison it would only ever report as a mismatch, sending the
  reader to the exporter for a defect that is in the file.

## Risks and testing

- **The risk is a check that cannot fail.** All nine goldens pass today,
  so a validator with an inverted condition or an unreachable branch
  would look identical to a working one. The acceptance procedure is
  therefore three planted defects read red first, one per format, not a
  green run.
- **A duplicate-key scan is easy to write wrongly**, because the
  obvious implementation (`JSON.parse` then compare key counts) cannot
  work -- the parse has already discarded the evidence. The plant for
  the OpenAPI case guards exactly this.
- The verbalize and validate goldens have no claimed format; the
  filename-derived union must skip them rather than fail them.
- One PR, followed by `npm run ci:local` from `barwise/` with the exit
  code read directly.

## Non-goals

- No new runtime dependency, and no new production code: this is all
  tests.
- No change to any renderer, to the mapper, or to any golden's content.
- No attempt at full format conformance -- this checks that a document
  is an instance of its format in the ways that have actually broken,
  not that it satisfies every rule in the specification.

## Implementation notes

**The second workstream did not survive grounding.** The draft had
`DdlExportFormat.test.ts` parse its rendered output through
`parseSqlWithSqlglot`. Probed against the built bridge before it was
written: sqlglot returns one statement with no errors for a `CREATE
TABLE` declaring the same column twice, and `undefined` only for SQL
that does not parse at all. A parser is not a validator, and the
issue's own design section had assumed otherwise. The resolved section
above carries the measurement.

**Where the validators live.** `packages/cli/tests/characterization/formatDefects.ts`,
with `formatDefects.test.ts` beside it. The split is deliberate: the
golden test can only exercise the validators on documents the exporters
currently produce, and those are valid -- so on its own it would be a
check nobody has seen fail. The unit tests carry the three barwise-961
shapes, minimised, plus the cases a naive validator gets wrong (a table
constraint read as a repeated column, an array element read as a key, a
string value read as a key, an escape resolved rather than kept).

**Red-first proof.** Each of the three shapes was planted in the real
golden file, and the suite read red before green:

| Plant                                                     | Reported                                                                   |
| --------------------------------------------------------- | -------------------------------------------------------------------------- |
| `provider_id` declared twice in `clinic-appointments.ddl` | `recorded clinic-appointments.ddl.txt is not a valid ddl document`         |
| two Avro fields named `medical_record_number`             | `recorded clinic-appointments.avro.txt is not a valid avro document`       |
| two OpenAPI properties on `medical_record_number`         | `recorded clinic-appointments.openapi.txt is not a valid openapi document` |

Each was then restored and the suite read 32 passed.

**What is still not guarded.** The validators check the classes that
have broken, not conformance to three specifications: an OpenAPI
document with a `$ref` to nothing, an Avro union written wrongly, or a
DDL type no dialect has would all pass. The nine export goldens are
checked; the verbalize and validate goldens are prose and have no
format to be an instance of.
