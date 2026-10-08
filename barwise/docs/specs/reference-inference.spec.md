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
(case- and separator-insensitive; the number rule is one function
shared with key-reference-tables.spec.md, never a second copy, PR #620
review; `U` matches in its own form or in
the other number by exactly these endings and no others: `ies` and
`y`, `es` and nothing, `s` and nothing -- so `categories` matches
`category`, `statuses` matches `status`, and an irregular plural such
as `people` matches only itself, PR #620 review), `U` is not
`T`, and the declared types match -- compared by the conceptual type
name alone, `parseSqlDataType(column.dataType)?.name` (`INT` and
`INTEGER` are one type; a length, precision or scale is ignored), with
no inference when either side's name is undefined, an unrecognised type
(PR #620 review). Not the importer's `columnDataType`, which keeps the
length and scale (so `VARCHAR(10)` would miss `VARCHAR(12)`), maps an
unknown type to `other` (so two unknown types would match), and maps an
identity key to `auto_counter` (so `site_id INT IDENTITY` would never
match the `INT` that refers to it): the referring column of a
generated key is a plain integer. For the same reason `auto_counter`
compares equal to `integer`: PostgreSQL's `SERIAL` stays in the
declared type and parses to `auto_counter`, unlike `INT IDENTITY`
(PR #620 review). `BIGSERIAL` and `SMALLSERIAL` parse to nothing
today, so a key declared with them infers nothing until core's type
mapping learns them. A column
that would match two tables infers nothing and is reported. Each inference is a warning naming the
column and the table, so it can be checked by eye.

A column in `T`'s primary key is never inferred (PR #620 review): an
inferred reference there would be the key-is-reference shape of
key-reference-tables.spec.md, and one opt-in guess would feed a second,
the subtype heuristic. Such a column is reported as a candidate and left
alone.

The flag is refused unless the format is `ddl` (`import model`) or the
command is `import sql`: `import model` serves every text importer,
and `--format openapi --infer-references` would otherwise appear to do
something it did not (PR #620 review). The refusal has its own test.

## Requirements

1. When `--infer-references` is absent, the DDL and SQL importers shall
   infer no reference from a column's name, whatever the names. (This
   covers name-based inference only: `import sql` already mines JOIN
   conditions into relationships, a separate source of evidence this
   spec leaves unchanged; PR #620 review.)
2. When it is given, for a column `X` of table `T` that is not in `T`'s
   primary key and has no declared foreign key, the importer shall read
   a reference to table `U` when `U` is the only table such that `X`
   matches `U`'s single key column by one of the three forms above,
   `U` is not `T`, and the declared types match (two or more such
   tables are requirement 3's; PR #620 review); and shall warn once per inferred reference, naming the column
   and the table.
3. When two or more tables meet every criterion of requirement 2 for a
   column -- name form, a single key column, not `T`, and the type --
   the importer shall infer nothing for it and shall warn naming the
   candidates. A table that matches by name but not by type is no
   candidate: `site_id INT` beside `sites.site_id INT` and
   `legacy_sites.site_id UUID` infers `sites` (PR #620 review).
4. When a matching column is in `T`'s primary key, the importer shall
   infer nothing for it and shall warn that it is a candidate.
5. When the flag is given to `import model` with a format other than
   `ddl`, the command shall exit non-zero with a message naming the
   formats that accept it.
6. The flag shall reach the DDL importer through `import model --format
   ddl`, through `import sql` on a file, and through `import sql` on a
   directory.

## Scope

In scope: requirements 1-6 in the DDL importer, with `SqlImportFormat`
threading the option through its file and directory flows (today it
passes `DdlImportFormat.parse` only `{ modelName }` in both); unit tests
for each matching form; one per ending pair (`categories` to
`category`, `statuses` to `status`, `subjects` to `subject`, each
in both directions) and an irregular plural (`people` does not match
`person`); an equivalent type spelling (`INT` against
`INTEGER`), a length difference (`VARCHAR(10)` against `VARCHAR(12)`,
inferred), an identity key (`INT IDENTITY` against `INT`, inferred), a `SERIAL`
key against `INTEGER` (inferred), a `BIGSERIAL` key (not inferred), an
unrecognised type on either side (not inferred), a type mismatch, a
self-table match, a composite-key target `U` whose first key column's
name and type match `X` (no inference: `U` has no single key column),
the ambiguous case, a name match whose type differs beside one that
qualifies (inferred to the one), the
key-column case, a column with a declared foreign key whose name suggests
another table (the declared reference wins, with no inference warning),
and the flag absent; CLI tests that
observe an inferred relationship through all three paths of requirement
6 and the refusal of requirement 5 (PR #620 review); the CLI docs; and
the capability-matrix row for the flag, marked as a deliberate CLI-only
divergence, in the same commit as the flag (CLAUDE.md, capability
matrix).

Out of scope: MCP and VS Code, until there is a use for the flag there;
dbt, whose relationships tests already state references.

## Workstreams

1. **The flag and the inference** (formats, cli): requirements 1-6, the
   tests above, the docs and the matrix row.
2. **The trial passes it** (trial): a per-artifact `import_flags` list in
   `customer.yaml`, appended as given by `importCommand` in
   `trial/lib/steps.mjs` (today it builds the arguments from importer,
   path and dialect alone). The CLI stays the one validator of its own
   flags: the trial keeps no allow-list, which would be a second copy of
   the command's options that drifts, and an unknown or misplaced flag
   fails the import step with the CLI's own message (PR #620 review). A
   trial test that an artifact's flags reach the command line, and one
   that a flag the CLI refuses fails the step; C07's BigQuery
   artifact given `--infer-references`; then a trial run and the C07 row
   reclassified. It depends on workstream 1.
