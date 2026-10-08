# Inferring references a schema does not declare, when asked to

Status: Draft -- no workstream implemented
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-c5f

In one sentence: `barwise import model --format ddl` and `import sql`
gain `--infer-references`, which reads a column named after another
table's key, with that key's type, as a reference to it, and reports
every reference it inferred; without the flag nothing changes.

## Principle

**Explicit over implicit: the user declares the convention, the
importer applies it.** Warehouse schemas routinely write no foreign keys
-- BigQuery's are `NOT ENFORCED` and usually omitted, and C07's skin
uses that idiom -- while naming every reference column after the key it
holds (`NETWORK_DEVICE.SITE_ID`). Reading those names as references is
right far more often than not, but not always (a `site_id` from another
system), and an importer that guessed by default would put
relationships into a model that no one stated.

## Options

| Option                                                 | C07 row                               | Risk                                              |
| ------------------------------------------------------ | ------------------------------------- | ------------------------------------------------- |
| A. infer by default, warn per inference                | passes                                | a wrong guess enters every import of every schema |
| B. infer behind `--infer-references` (recommended)     | passes when the trial passes the flag | none by default; the flag is the declaration      |
| C. never infer; declare the C07 checks not_expressible | stays out of reach                    | none; also no help for the common warehouse case  |

The rule under B: a column `X` in table `T` references table `U` when
`X` equals `U`'s single key column name, or `<U>_<key>`, or `<U>_id`
(case- and separator-insensitive, `U` singular or plural), `U` is not
`T`, and the declared types match; a column that would match two tables
infers nothing and is reported. Each inference is a warning naming the
column and the table, so it can be checked by eye.

A column in `T`'s primary key is never inferred (PR #620 review): an
inferred reference there would be the key-is-reference shape of
key-reference-tables.spec.md, and one opt-in guess would feed a second,
the subtype heuristic. Such a column is reported as a candidate and left
alone.

## Scope

In scope: the flag on the DDL and SQL importers (the SQL importer reads
CREATE TABLE through the DDL importer since barwise-jjd, and today
passes it only `{ modelName }` in both its file and directory flows, so
the option must be threaded through both), tests for each matching
form, the ambiguous case and the key-column case, CLI tests that observe
an inferred relationship through `import model --format ddl` and
through `import sql` on a file and on a directory (PR #620 review), a trial per-artifact
`import_flags` so C07's BigQuery artifact can pass it, and the CLI docs.

Out of scope: MCP and VS Code (the capability matrix records the
divergence as deliberate until there is a use for it there); dbt, whose
relationships tests already state references.
