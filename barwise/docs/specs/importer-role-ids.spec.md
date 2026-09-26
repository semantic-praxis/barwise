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

## Requirements

- **R1.** When an importer creates a role, it shall take the role's id
  from `generateId()`, never from a string built out of names or other
  ids.
- **R2.** When two imported fact types share a player or a name (two
  tables with a `name` column, two foreign keys with the same inferred
  verb), the importer shall still produce distinct role ids, so that
  `barwise validate` reports no duplicate-role-id error on the result.
- **R3.** When an importer is registered in the format registry, the
  registry test shall either run it over a fixture and check every id it
  emits, or name it in a stated exemption; an importer in neither fails
  the test.

## Alternatives considered

- **Omit role ids and let the `Role` default mint them.** A role with no
  `id` already gets one from `generateId()`. It fails here because every
  one of these sites passes the role id into a constraint (`roleIds`,
  `roleId`) in the same `addFactType` call that creates the role, so the
  id has to exist first. Supporting it would mean constraints that name
  roles by position and a resolution step inside core -- a new API to fix
  three call sites.
- **Keep readable ids but make them unique** (for example,
  `<fact type id>::role1`). Fixes the collision and keeps ids legible in
  the YAML. Rejected: it keeps a second id policy alive beside
  `generateId()`, so creation order stays invisible for roles, and the
  next importer would copy it. The UUIDv7 spec made the id policy a single
  decision; this restores that rather than adding a sanctioned exception.
- **Assert id shape (a UUIDv7 regex) in each importer's own tests** instead
  of one registry test. Rejected on evidence: the DDL/OpenAPI ids were
  `<uuid>-has-Name-role`, which a prefix-anchored shape check passes, and
  a per-package test does not notice a newly registered importer. The
  counting generator is an oracle no hand-built id can satisfy, and
  iterating the registry covers importers by declaration.

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

## Exemption, and why

- **norma** keeps the role ids from the source `.orm` file on purpose
  (`formats/src/norma/mapping/factTypes.ts:30`, "Preserve NORMA role id for
  constraint mapping"). Those are the source tool's GUIDs, not names built
  from names. Whether NORMA imports should re-mint is a separate question,
  filed as barwise-1070.

The three code importers (typescript, java, kotlin) are covered, not
exempt: with no language server on PATH they fall back to regex analysis,
which runs in milliseconds, so the test gives them one small source tree.
The first draft exempted them as needing a live server; review showed the
fallback, and the test now runs it.

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
  the registry test red for that importer. For the DDL foreign-key path
  this needed table-level `FOREIGN KEY` lines in the fixture: the importer
  does not read an inline `REFERENCES`, so the first fixture never reached
  that path and a reverted fix stayed green. Measured after the change:
  reverting only `createForeignKeyFactType` fails the DDL case with four
  hand-built ids named.
- Per package: `npm run build`, then the dbt, formats and cli suites, then
  `npm run ci:local` before push.
