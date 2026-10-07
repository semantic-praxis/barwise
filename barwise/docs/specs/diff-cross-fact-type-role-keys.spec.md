# A constraint's diff key names every role by position, not only its host's

Status: Implemented -- the one workstream landed with this spec
Created: 2026-10-07
Last-updated: 2026-10-07
Tracking: barwise-b7z (join constraints: barwise-q8x); found by `ddl-round-trip-fixed-point.spec.md`,
workstream 6

In one sentence: the diff keys a constraint's roles by position only
when they belong to the fact type that hosts it, and by raw id
otherwise, so after any import that mints new role ids every external
uniqueness -- and every exclusion, subset or equality that spans fact
types -- reads as removed and added though it names the same roles.

## Principle

**Determinism in core, applied to what "the same" means.** `diffModels`
is a pure function, and its constraint key exists so that two models
that say the same thing produce no delta: `constraintKey`'s own comment
says it replaces role ids with positions "to eliminate false-positive
diffs caused by fresh UUIDs". It does that for half the roles a
constraint can name. `resolveRole` falls back to the raw id for a role
outside the host fact type, and the comment on it calls that the
handling for cross-fact-type constraints -- which is the case the key
fails on, not a case it handles.

The cost is measured. Over the 12 trial kernels, a DDL round trip
brings all 23 external uniquenesses back over the same roles
(`BarwiseAnnotation.test.ts` pins it), and the diff reports 23 removed
and 23 added. The kernel delta count rose from 528 to 535 in the PR
that made the import better. An instrument that moves the wrong way
when the thing it measures improves is the shadow-and-property failure
the root `CLAUDE.md` names.

## Scope

In scope:

- When a constraint names a role outside its host fact type, the diff
  shall key that role by the name of the fact type that holds it, in
  the same model, and its position there.
- When a role id resolves to no fact type in its model (a dangling
  reference), the diff shall key it by its raw id, as today.
- When a constraint names only roles of its host, its key shall be
  unchanged, so no existing delta changes for such a constraint.

Out of scope:

- **Host independence.** An external uniqueness that moved from one
  fact type to another still reads as removed from one and added to the
  other. See Open decisions.
- **Join constraints.** `join_subset`, `join_equality` and
  `join_exclusion` key by their operand paths, whose steps carry role
  ids; they fail the same way. They are rare in the corpus (none in the
  kernels) and their key is a different function: barwise-q8x.

## Inventory

| Module                               | Current state                                               | Verdict                                                                     |
| ------------------------------------ | ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `core/src/diff/elementDiff.ts`       | `resolveRole(id, idxMap)` returns the raw id off the host   | changes: falls back to `<fact type name>#<index>` through the model         |
| `core/src/diff/elementDiff.ts`       | `diffConstraints(a, b, rolesA, rolesB)`                     | changes: receives each side's model, which `diffFactType` already holds     |
| `core/src/diff/ModelMerge.ts`        | takes an accepted modified fact type's constraints verbatim | untouched: fewer false "modified" fact types can only mean fewer such takes |
| `core/src/diff/changeDescription.ts` | `constraintsAdded` / `constraintsRemoved` carry constraints | untouched: the shapes stay; only which constraints land in them changes     |
| `core/tests/diff/ModelDiff.test.ts`  | no cross-fact-type constraint case                          | gains: an external uniqueness over regenerated role ids reads as unchanged  |

`ModelMerge.ts` reads deltas, not keys. A fact type whose only
difference was a false constraint change now reads as unchanged, so a
merge keeps the existing version instead of taking the incoming one
whole. That is what an unchanged fact type should do.

## Target architecture

```ts
// elementDiff.ts -- the only file that changes.
function resolveRole(
  id: string,
  idxMap: Map<string, number>,
  model: OrmModel,
): string {
  const idx = idxMap.get(id);
  if (idx !== undefined) return String(idx);
  // A role of another fact type: its position there, named by that fact
  // type, which the diff matches by name as well.
  const home = model.factTypes.find((ft) => ft.getRoleById(id));
  return home ? `${home.name}#${home.roles.findIndex((r) => r.id === id)}` : id;
}
```

The fact-type name is the right anchor because it is what `diffModels`
already matches fact types by: two fact types with the same name are
the same fact type to the diff, so their roles at the same position are
the same roles.

## Alternatives considered

- **Key every role, host included, by `<name>#<index>`.** Uniform, but
  it changes the key of every constraint in every diff, and a fact type
  renamed between the two models would turn each of its internal
  constraints into a removal and an addition. The host's roles keep
  their bare index.
- **Key a foreign role by its player's name and position.** Survives a
  fact-type rename, but two fact types between the same players (a
  common shape: Person was born in Country, Person lives in Country)
  collide. The diff matches fact types by name, so the key should too.

## Workstreams (each independently shippable)

### 1. Key foreign roles by fact type and position

`resolveRole` gains the fallback above; `diffConstraints` and
`constraintKey` thread the model through; `diffFactType` passes
`existingModel` and `incomingModel`. One test in `ModelDiff.test.ts`
builds a model with an external uniqueness spanning two fact types,
regenerates every role id, and asserts no delta; a second moves one
role to another position and asserts the change is reported; a third
pins the host-move behaviour the open decision below keeps.

Acceptance: when two models differ only in role ids, the diff shall
report no constraint change for any constraint type except the join
constraints.

## API and migration impact

- No public export changes. `resolveRole`, `constraintKey` and
  `diffConstraints` are module-private.
- Downstream: the CLI's `diff`, the MCP `diff_models` tool, merge and
  the trial grader all call `diffModels`; each sees fewer deltas, never
  more. The trial gate's `model-roundtrip:*` rows report lower counts;
  no row's status should change, since each still has other deltas.

## Open decisions (for review)

- **Should an external uniqueness be compared independent of its host?
  (recommended: no, not in this spec.)** ORM does not care which fact
  type hosts an external uniqueness, and the DDL import may host one
  differently from the original (C03's policy period). A model-wide
  comparison would report no change for a moved constraint. The cost is
  in merge: it rebuilds fact types from deltas, so a constraint whose
  move is reported nowhere is dropped when the old host is accepted as
  modified for another reason and the new host is unchanged. Reporting
  the move as a removal and an addition keeps merge correct. Revisit if
  host moves turn out to be common outside the DDL import.

## Risks and testing

- Constraints over host roles only must key exactly as before; the
  existing `tests/diff/` suite covers them and must pass unchanged.
- Run the full monorepo build and tests: core's diff feeds every
  surface.
- Run the trial gate after; its baseline should have no new and no
  stale rows.

## Non-goals

- No change to how fact types or object types are matched.
- No change to merge.

## Implementation notes

- **Measured over the 12 kernels' DDL round trip:** 535 deltas to 520.
  Of the 23 external uniquenesses, 15 now read as unchanged. The other
  8 are real differences the diff should report: 7 host moves (the DDL
  import hosts a constraint on the first `UNIQUE` column's fact type,
  so C02, C03, C05, C06 and C09 each move one or two) and 1 lost
  modality (C12's deontic "Sanction is imposed on Recipient" comes back
  alethic, since a `UNIQUE` cannot say "ought").
- **The draft planned a formats corpus assertion** that the round trip
  reports no external-uniqueness change. The measurement above shows
  why it cannot hold while host moves are reported, so it was dropped;
  `BarwiseAnnotation.test.ts` already pins that every external
  uniqueness comes back over the same roles, and the core test pins the
  key.
- **The draft's unit test assumed two builds differ in role ids.** The
  test `ModelBuilder` mints deterministic ids, so the test rewrites
  them through a YAML round trip instead.
