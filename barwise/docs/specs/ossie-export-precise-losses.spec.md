# The Ossie export reports what it cannot write, precisely

Status: Implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-5x3, barwise-huw
Plan-reviewed: 7acdf232 (code-review, pr-review)
Touches: barwise/packages/formats/src/ossie/writeOssie.ts,
barwise/packages/formats/src/ossie/verifyOssie.ts,
barwise/packages/formats/src/ossie/OssieExportFormat.ts,
barwise/packages/core/src/diff/index.ts,
barwise/packages/formats/tests/OssieExportFormat.test.ts,
+barwise/packages/formats/tests/OssieLossScope.test.ts,
barwise/docs/specs/ossie-export-verified-by-reimport.spec.md

When the Ossie export meets something it cannot write, it shall say so
in a loss line that names the thing, and shall not crash. Today two
cases miss that:

- **barwise-5x3.** A model whose internal uniqueness names a role from
  another fact type crashes the writer.
- **barwise-huw.** A loss line on an object type silences every other
  read-back difference on that object type, including ones the line
  does not explain.

## Principle

Define errors out of existence, and keep the instrument honest. A model
that validation reports as an error still loads, and the DDL, OpenAPI,
Avro and NORMA exports all complete on it. So the Ossie writer should
treat the stray role as one more thing it cannot write, not as a reason
to fail. The read-back check exists because the writer's predictions
were wrong three times. A prediction that silences differences it does
not explain hides exactly the defect the check was built to find.

## Observed today (at ce061270)

- `barwise export packages/vscode/tests/fixtures/validation-errors.orm.yaml
  --format ossie` exits 1 with `Cannot read properties of undefined
  (reading 'playerId')`.
  - In that fixture, `Person has Age` carries an internal uniqueness over
    `r-person-name`, a role of `Person has Name`.
  - `barwise validate` reports this as an error. The other four exports
    exit 0.
- In `writeOssie.ts`, `roleOrder` maps a single-role uniqueness to
  `ft.roles.findIndex(...)`. For the stray role that index is -1, and
  `first(-1)` builds an order that holds role -1.
  - `identifierRole` and `writeRelationship`'s `position` make the same
    lookup.
  - They, and the identify_by lookup at lines 201-202, read
    `ft.internalConstraints` directly.
- `verifyOssie` skips any delta whose element key is in `reported`.
  `writeOssie` adds a key on every loss line (`lose`), whatever the line
  says.
- Measured over the 84 tracked models that load
  (`scratchpad/huw-measure.mjs`), with `reported` emptied:
  - 1,666 read-back differences are silenced today.
  - 1,474 of them are changes on object types.
- Mapping each silenced object-type change to the loss line on the same
  object type that names it (reference mode, preferred identifier,
  source context, data type, aliases) leaves one change unexplained. It
  is Student in `trial/customers/C10-university/kernel.orm.yaml`, whose
  preferred identifier comes back as an external one over StudentNumber
  and Campus. Its loss lines are about the reference mode only.
- `ChangeDescription` is exported from `@barwise/core/diff`. Each
  `ModelDelta.changes[i]` renders as `changeDescriptions[i]`.

## Scope

### Workstream 1: a stray role is a loss, not a crash (barwise-5x3)

- The writer shall work out a fact type's own internal constraints once,
  in the loop that builds `Written`, before `roleOrder` runs. The own
  constraints are those whose every role, by core's `roleIdsOf`, is one
  of the fact type's roles. They are passed to `roleOrder` and
  `identifierRole`, and stored on `Written` for `writeRelationship`
  and for the identify_by lookup at writeOssie.ts:201-202. So every
  reader in the writer sees the same list.
- Each internal constraint left out shall be reported once, where the
  list is worked out, through `loseConstraint`. That way it gets a
  `constraintSpecs` entry like every other constraint the writer
  cannot write. The line reads `<kind> names a role that is not one of
  this fact type's roles; not written`. A fact type later skipped
  because built-ins play every role still gets the line.
- When the fixture above is exported, the export shall exit 0, print
  that line once for `Person has Age`, and list the constraint in
  `constraintSpecs`.
- The importer (`mapOssieToOrm.ts`) is unchanged: every constraint it
  reads is one it built on its own fact type.

### Workstream 2: an object-type loss line covers only what it explains (barwise-huw)

- `OssieWriteResult.reported: ReadonlySet<string>` becomes
  `covers: ReadonlyMap<string, ReadonlySet<ChangeKind> | "all">`,
  where `ChangeKind` is `ChangeDescription["change"]`. One map states,
  per key, what the writer's lines cover. `"all"` wins over a set.
- `Lose` takes a fourth argument, `explains: readonly ChangeKind[] |
  "all"`.
  - It is required when the key is an object type, so an object-type
    line that does not say what it explains is a compile error, not a
    silent return of barwise-huw.
  - For every other key it is optional and defaults to `"all"`, which
    is today's behaviour.
- When `verifyOssie` meets a modified delta whose key is covered by a
  set, it shall drop the changes the set names. It reports a line only
  if some change remains, and that line names only the remaining
  changes. A set never covers a removed or added delta.
- The object-type lines are scoped by this table. Each row is every
  call site whose text matches it.

  | Line text                                                               | Explains                                 |
  | ----------------------------------------------------------------------- | ---------------------------------------- |
  | `aliases ... not written`                                               | `aliases`                                |
  | `independence not written`                                              | `independent`                            |
  | `population cardinality not written`                                    | `cardinality`                            |
  | `source context ... not written`                                        | `sourceContext`                          |
  | starts `note line not written` (four sites) or `note comes back`        | `note`                                   |
  | `default value ... not written`                                         | `defaultValue`                           |
  | `no data type; written as String`                                       | `dataTypeAdded`                          |
  | `data type ... written as ...`, `data type length or scale not written` | `dataTypeChanged`                        |
  | `value constraint is not a shape ...`                                   | `valueConstraint`                        |
  | `no identifier Ossie can state; reference mode ... not written`         | `referenceMode`                          |
  | `reference mode ... not written` (two sites)                            | `referenceMode`                          |
  | `its preferred identifier is not one Ossie's identify_by can name`      | `preferredIdentifier`                    |
  | `written as <name>, a name Ossie can read back`                         | `name`                                   |
  | `a built-in no role uses is not written`                                | `"all"` (the element does not come back) |

- The table is a copy that must agree with `diffObjectType`, so it
  carries a drift test. There is one case per row: a minimal model on
  which that line is the only loss line on its object type, read back
  with nothing covered. The case asserts that the change kinds on that
  object type are exactly the row's set. A row that is too narrow adds
  a false line, and a row that is too broad silences a real one; either
  way the case fails.
- barwise-huw's case gets its own test: an entity with no stored
  preferred identifier, a reference mode Ossie cannot write, and an
  external uniqueness that core reads as identifying it, so the writer
  writes it as `identify_by` (the no-stored-identifier branch). The
  export shall print the preferred-identifier change, and the test
  shall fail when the scoping is removed.
- The corpus measurement is re-run through the export. It is expected
  to gain exactly one line, Student's.

Out of scope:

- Scoping fact-type lines. Their read-back differences are mostly
  constraints added or removed, and the line-to-constraint link needs
  per-constraint keys. That is barwise-huw's option (b) for fact types,
  filed as a follow-up if this lands.
- Changing what Student's export writes. The new line reports it, and
  whether it is right is the barwise-alg question that is already
  decided.

## Implementation notes

- As planned, with one row narrowed. The "no identifier Ossie can state"
  line was planned to explain `referenceMode` and `preferredIdentifier`.
  Implementation found the second one spare:
  - an entity whose stored identifier cannot be written always also gets
    the "its preferred identifier is not one Ossie's identify_by can
    name" line;
  - an entity with no stored identifier has no identifier change to
    explain.

  Over the corpus, dropping it changes no output. A narrower row can
  only add a line, never hide one, so the row explains `referenceMode`
  alone.
- Measured through the export, before and after, over the 84 tracked
  models that load:
  - `validation-errors.orm.yaml` exports instead of throwing, with the
    one stray-role line;
  - there is one new read-back line, Student's preferred identifier;
  - nothing else changes.
- `OssieExportFormat.test.ts`'s ring test built its constraint with
  `roleIds`, a field `RingConstraint` does not have. Its roles were
  never real role ids, so the stray-role filter caught it. The fixture
  now uses `roleId1` and `roleId2`, and what it asserts is unchanged.
- `OssieLossScope.test.ts` holds the table to the diff. Each case checks
  that the line's set is wide enough (no line on the element) and that
  no kind in it is spare (each one, taken out, leaves a line). Seen red:
  - making every line cover its element whole fails every row case
    and the barwise-huw case;
  - adding `name` to the aliases row fails that row;
  - keeping the stray constraint fails the barwise-5x3 case.

- Implementation review:
  - The stray-role line explains `constraintsRemoved` only. Covering its
    fact type whole would have silenced any other difference there, the
    defect this spec removes. It is the one scoped fact-type line, and
    the corpus output is unchanged by it.
  - The drift test now has a case for every row and every call site the
    first version missed: the preferred-identifier line, the reordered
    note, the three notes that would read back as something else, and
    the subtype's reference mode. That is 21 cases in all.
  - `ChangeKind` is core's own, now exported from `@barwise/core/diff`,
    not a second definition in the writer.
  - The barwise-5x3 test pins the one constraint spec, not "at least one".
  - Declined: narrowing `Explains` on object-type lines to the
    object-type change kinds. That is a second hand-kept list of the same
    facts the table holds. A wrong kind on a row already fails that
    row's "wide enough" check, because the kind the line really causes
    is left unexplained.

## Open decisions

1. **5x3: skip the stray constraint, or refuse the model?**
   - (a) Skip it with a loss line (recommended). This matches the other
     four exports. The line names the problem, and `validate` already
     reports it.
   - (b) Refuse the export, naming the constraint. This is explicit, but
     it would be the one export that refuses a model the others write.

   Recommend (a).
2. **huw: scope all lines, or only the object-type ones?**
   - (a) Object types only (recommended). The measured silenced case is
     there, and each line names one field. The mapping is a 12-row
     table.
   - (b) Every line. This is the issue's full option (b). It needs a
     constraint-level key on fact-type lines, and nothing measured needs
     it yet.

   Recommend (a). Object-type lines must say what they explain; the
   others keep today's behaviour through the `"all"` default.

## Risks and testing

- A wrong table row either adds a false line or silences a real one.
  The per-row drift test catches both. The corpus re-measure is the
  second check.
- `reported` is renamed and retyped as `covers`. Its consumers are
  `verifyOssie` and `OssieExportFormat`, and tests that read it.
  The compiler finds each one.
