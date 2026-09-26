# dbt import keeps two relationships from one model to the same target

Status: Implemented 2026-09-26 -- the single workstream (see Implementation notes)

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-bvl

`barwise import dbt` names every relationship fact type
`<Source> has <Target>`. A model with two `relationships` tests to the
same target -- a leg's origin and destination ports, a bundle's parent
and component products -- derives the same name twice, and
`OrmModel.addFactType` throws: the import exits 1 with no model. barwise's
own dbt export produces this shape from any ring constraint or any table
with two foreign keys to one table, so the dbt round trip fails on most
models (the enterprise trial's C01, C04, C06 and C11 rows). After this
change both relationships import, each named from its foreign-key
column, and no relationship shape makes the import throw.

## Principle

**Define errors out of existence.** A dbt project with two foreign keys
to one table is ordinary; an importer that can be made to throw by an
ordinary project, including one barwise wrote, has pushed a naming
decision onto every user. The name is derivable from what the project
already says -- the column -- so the importer decides it.

## What the user sees (1.7.0; reproduction `trial/findings/barwise-bvl`)

`stg_leg` has `origin_port_id` and `destination_port_id`, each with a
`relationships` test to `stg_port.port_id`:

```
Error: Fact type "Leg has Port" already exists in model "dbt Import"
```

exit 1, no model written.

## Requirements

- **R1.** When a model has more than one relationship to the same target
  model, the importer shall name each relationship whose foreign-key
  column carries more than the target's key -- `origin_port_id` against
  key `port_id` -- as `<Source> has <qualifier> <Target>`, with the
  qualifier taken from the column (`origin`), and give it the reading
  `<Source> has <qualifier> <Target>`. A relationship whose column adds
  nothing (`port_id` itself) keeps the plain name.
- **R2.** When a relationship's fact type name is still taken after R1,
  the importer shall use the first free `<name> (<column>)` and report
  it, rather than throw.
- **R3.** A model with a single relationship to a target keeps today's
  name and reading, so existing imports do not move.

Acceptance: the reproduction imports with exit 0 and two fact types,
`Leg has origin Port` and `Leg has destination Port`, and the model
validates.

## Scope

Out of scope:

- The relational mapper names a foreign-key column after the target's
  key column (`port_id`, then `fk_port_id`), not after the role, so a
  dbt export of the imported model does not restore `origin_port_id`.
  That is the mapper's naming rule and changes every export; it is a
  separate change.
- The existing relationship reading `{0} has {1}` over roles ordered
  target-first, which verbalizes backwards for the unqualified case.
  R3 keeps it so no existing import moves; qualified relationships get a
  correct reading.

## Workstream (single)

In `dbt/src/dbtMapping/factTypes.ts`, count relationships per target
within a model; for a target reached more than once, derive the
qualifier from the column (strip `_<targetField>`, else `_id`, and turn
underscores into spaces); build the name and reading; and guard
`addFactType` with a free-name fallback and a report warning.

## Risks and testing

- **Qualifier quality** depends on column naming. A column that does not
  end in the target key or `_id` contributes its whole name, which reads
  worse but is still distinct.
- Tests in `dbt/tests/dbtMapping/` over the reproduction, a
  self-referencing model, and a forced collision for R2; the offline
  trial on a fresh bundle for the C01, C04, C06 and C11 rows; `ci:local`.

## Open decisions

None.

## Implementation notes

Landed as specified in `dbt/src/dbtMapping/factTypes.ts`
(`relationshipQualifier`, `freeFactTypeName`).

- Qualified relationships also get the reverse reading
  `<Target> is <qualifier> of <Source>` ("Port is origin of Leg").
- Acceptance, through a freshly built CLI bundle: the reproduction
  imports with exit 0, verbalizes "Leg has origin Port" and "Leg has
  destination Port", and validates with 0 errors and 0 warnings.
- 6 of the 7 new tests fail without the change; the seventh is R3's
  control, a single relationship keeping today's name.
