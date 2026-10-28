# The dbt export writes the current test syntax

Status: Implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-fnt
Plan-reviewed: a22cc134 (code-review, pr-review)
Touches: barwise/packages/core/src/mapping/renderers/dbt.ts,
barwise/packages/core/tests/mapping/dbt.test.ts,
barwise/packages/dbt/src/DbtSchemaParser.ts,
barwise/packages/dbt/tests/DbtSchemaParser.test.ts,
barwise/docs/IMPORT_EXPORT.md,
barwise/docs/release-notes/unreleased.md,
barwise/trial/lib/generators/dbt.mjs

When barwise exports a dbt project, each generic test that takes
arguments shall carry them under `arguments:`, and tests shall be listed
under `data_tests:`. Today the export puts arguments directly under the
test name. From dbt 1.10.8 that raises
`MissingArgumentsPropertyInGenericTestDeprecation`, and dbt's
deprecations page says every listed deprecation must be resolved before
upgrading to Fusion (dbt 2.x). The user's projects run dbt 1.10 and move
to 2.x next month. So an export with a foreign key or a key over several
columns warns today and has to change before the move. An export whose
tests are only `not_null` and `unique` takes no arguments and is
unaffected.

## Principle

Determinism and explicit over implicit. A generated file should be one
the target tool reads without warnings, in the form its current version
documents, and the form should be written in one place. The importer
already reads both forms, so only the writer changes.

## Observed today (at 0818b769)

- `renderDbt` (`core/src/mapping/renderers/dbt.ts`) is the export's only
  writer of dbt test YAML.
  - It writes `tests:` on each column (`entry.tests`) and on the model
    for a key over several columns.
  - It writes `relationships: { to, field }` and
    `dbt_utils.unique_combination_of_columns: { combination_of_columns }`,
    with the arguments directly under the test name. `not_null` and
    `unique` are bare strings and take no arguments.
- `DbtSchemaParser` reads `data_tests ?? tests` in `parseModel` and
  `parseColumn`. `parseObjectTest` reads a test's arguments from
  `arguments:` or the top level, the top level winning (barwise-lqj).
  Its merge `{ ...args, ...given }` also keeps the `arguments` object
  itself in the parsed config, so a custom test read from the new form
  carries a stray nested `arguments` key.
- `trial/lib/generators/dbt.mjs` also writes dbt test YAML in the old
  form. It builds the trial projects that stand in for customer-written
  dbt projects, which the importer must read in either form.
- dbt's documentation, read from its docs repository:
  - The data tests reference says a test's arguments "should be nested
    below the `arguments` property".
  - The flag `require_generic_test_arguments_property` governs it. It
    was introduced in 1.10.5 and became true by default in 1.10.8.
    - With the flag true, a top-level argument raises
      `MissingArgumentsPropertyInGenericTestDeprecation`.
    - With it false (the default on 1.10.5 to 1.10.7), `arguments:`
      raises `ArgumentsPropertyInGenericTestDeprecation`.
    - Before 1.10.5, `arguments` is not recognized.
  - The deprecations page says: "Upgrading to Fusion? You must resolve
    all deprecations listed on this page before upgrading."
  - `tests:` is not deprecated. dbt keeps it "as an alias for
    `data_tests:`", the name dbt 1.8 introduced, and documents
    `data_tests:` throughout.
- Six `dbt.test.ts` tests read `.tests` from the rendered YAML (lines
  159, 182, 210, 244, 278, 317). A prototype fails four of them. Two
  more, "omits relationship tests when disabled" and "does not add tests
  to nullable non-key columns", would pass whatever is written, since
  `.tests` is never written any more.
- With the prototype, the dbt, cli, mcp and formats suites pass
  unchanged. `dbt/tests/compositeKeyExport.test.ts` exports through
  `DbtExportFormat` and re-imports, and it needs both the key test and
  a `relationships` column read back from `arguments:`.

## Scope

- `renderDbt` shall write `data_tests:` on columns and models.
- It shall write every test that takes arguments through one helper,
  `genericTest(name, args)`, which returns `{ [name]: { arguments: args } }`.
  `relationships` and `dbt_utils.unique_combination_of_columns` use it.
  `not_null` and `unique` stay bare strings.
- All six `dbt.test.ts` readers move to `data_tests` and `arguments`,
  so the two that could not fail can fail again. A new assertion pins
  the exact YAML of one relationships test and one model-level key test.
  It fails on today's output.
- `compositeKeyExport.test.ts` is the round-trip check. It passes
  unchanged.
- `parseObjectTest` drops the `arguments` key from a parsed config, so
  the new form reads back exactly as the old one does. A parser test
  pins this, and it fails today.
- `IMPORT_EXPORT.md` (dbt section) and the release note say the export
  writes `data_tests:` with `arguments:`, read without warnings from
  dbt 1.10.8. On 1.10.5 to 1.10.7 the project sets
  `require_generic_test_arguments_property: true`. Before 1.10.5 it
  cannot read the tests.
- `trial/lib/generators/dbt.mjs` keeps the old form, on purpose. It
  stands in for customer projects, many of which are still written that
  way, so it keeps the importer's old-form path exercised. This choice
  is recorded in the generator.

Out of scope:

- The importer, which already reads both forms.
- Other dbt 1.10 deprecations barwise does not write (custom top-level
  keys, properties moved under `config:`). Barwise writes no such keys
  today; the implementation re-checks by reading the rendered YAML.
- barwise-ivl's `constraints:` block, which comes next and uses no
  generic test.

## Implementation notes

- As planned. The export writes `data_tests:` and puts the inputs of
  `relationships` and `dbt_utils.unique_combination_of_columns` under
  `arguments:`. The guide and the release note give the version rule
  (warning-free from 1.10.8, or from 1.10.5 with the flag set). The trial
  generator keeps the old form on purpose, with a comment saying why.
- Red check: on the unfixed source, four renderer tests and the parser
  test fail. With the fix the core, dbt, cli, mcp and formats suites
  pass, and `compositeKeyExport.test.ts` round-trips unchanged.
- Implementation review, fixed:
  - The parser drops the `arguments` key only when it is a block. An
    older test's own input named `arguments` (a list, say) is kept, as it
    was before.
  - Where a half-migrated test names one input both ways, `arguments:`
    now wins. That is what dbt does from 1.10.8, so the test imports as
    dbt runs it. barwise-lqj had let the top level win, and no test or
    spec line depended on that.
  - A renderer test pins the emitted YAML text of a relationships test and
    asserts no `tests:` key appears anywhere. That also closes the two
    tests that could pass with the tests written under the old key.
  - Parser tests pin a column's `relationships` read from `arguments:`,
    the precedence, and the kept older input.
  - The trial generator is in Touches.

## Open decisions

1. **Minimum dbt version.**
   - (a) Write only the new form (recommended). It is warning-free from
     1.10.8, and on 1.10.5 to 1.10.7 with the flag set to true. It is
     required before the move to 2.x. A project before 1.10.5 cannot read
     it.
   - (b) Add an export option for the old form. That keeps old projects
     working, but it is a second form to keep correct, for versions dbt
     itself is moving off.

   Recommend (a), confirming with the user that their 1.10 projects are
   on 1.10.8 or later, or set the flag.

## Risks and testing

An existing barwise-generated `schema.yml` that someone regenerates
changes shape. That is the intended change. The importer reads both
forms, so a re-import is unaffected.
