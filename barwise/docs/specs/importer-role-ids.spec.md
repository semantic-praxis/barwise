# Importers mint role ids through generateId, like every other element

Status: Implemented -- single workstream, landed with this spec

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-1069

The dbt, DDL and OpenAPI importers built role ids by hand from names --
`Customers has CustomerName::role1`, `<uuid>-has-Name-role` -- instead of
asking `generateId()`. So an import in the VS Code extension, the CLI or the
MCP server produced UUIDv7 ids for every element except roles, and the DDL
and OpenAPI forms were worse than cosmetic: they collide. Each importer now
mints role ids with `generateId()`, and one test fails when any registered
importer emits an id the generator did not mint.

## Principle

**Explicit over implicit, and one home for a decision.** "How is an element
id minted" was decided once, in `core/src/model/id.ts`, with the surface
installing UUIDv7 at startup (`uuid7-identifiers.spec.md`). Three importers
re-decided it locally for one element kind, and nothing noticed, because a
role config that carries an `id` is never passed to the generator.

## What was wrong (measured 2026-09-26)

| Importer                                               | Role id it wrote                                                                      | Consequence                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------- | -------------------------------------- |
| dbt (`dbt/src/dbtMapping/factTypes.ts`)                | `<Entity> has <Value>::role1`                                                         | Not a UUID; no creation order          |
| DDL (`formats/src/ddl/DdlImportFormat.ts`)             | `<value type id>-has-role`, `<entity id>-has-<Value>-role`, `<entity id>-<verb>-role` | Looks like a UUID but is not; collides |
| OpenAPI (`formats/src/openapi/OpenApiImportFormat.ts`) | same patterns as DDL                                                                  | same                                   |

The collision is a correctness bug. A value type is shared by name across
tables, so two tables with a `name` column gave two roles the id
`<Name's id>-has-role`. Measured: `barwise import model two-tables.sql
--format ddl` followed by `barwise validate` reports `Role ids must be
unique across the model` -- an import that validates as broken. The same
happens for two foreign keys from one table that infer the same verb.

A dbt import of a two-model project produced 13 UUIDv7 ids and 6 textual
role ids.

Nothing parses these ids: a search of `packages/*/src` for `::role` or a
`-role` suffix finds only the three sites that build them.

## Design

- The three importers call `generateId()` (exported from `@barwise/core`)
  for each role id they need to reference from a constraint before the fact
  type exists. Role ids they never reference could be omitted and left to
  the `Role` default, but using `generateId()` for all of them keeps each
  site one rule.
- `packages/cli/tests/importerIds.test.ts` installs a counting generator
  (`gen-1`, `gen-2`, ...) and runs every importer in the format registry
  over a small fixture. It asserts that every object type, fact type, role
  and constraint id is one the generator minted, and that no id repeats. It
  lives in the CLI package because that is the one package that depends on
  every importer. An importer registered without a fixture or a stated
  exemption fails the test, so a new importer is covered by declaration,
  not by someone remembering.

## Exemptions, and why

- **norma** keeps the role ids from the source `.orm` file on purpose
  (`formats/src/norma/mapping/factTypes.ts:30`, "Preserve NORMA role id for
  constraint mapping"). Those are the source tool's GUIDs, not names built
  from names. Whether NORMA imports should re-mint is a separate question,
  filed as barwise-1070.
- **typescript, java, kotlin** need a live language server, which the test
  environment does not have. A search of `code-analysis/src` finds no
  hand-built ids; the exemption says so and names that search.

## Out of scope

- Models imported before this change keep their textual role ids. They
  load and validate as before (except the DDL/OpenAPI collisions, which
  were already invalid). Re-importing mints new ids.
- `@barwise/core`'s own test helper (`tests/helpers/ModelBuilder.ts`) builds
  `::role1` ids for fixtures. That is test data, not importer output.

## Risks and testing

- No output format depends on role ids being readable; exports name
  columns and fields from object types and role names.
- Mutation check: reverting any one importer to its hand-built ids turns
  the registry test red for that importer.
- Per package: `npm run build`, then the dbt, formats and cli suites, then
  `npm run ci:local` before push.
