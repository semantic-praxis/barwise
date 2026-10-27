# An Ossie identifier makes its roles mandatory

Status: Proposed

Created: 2026-10-27
Last-updated: 2026-10-27
Tracking: barwise-3ik
Touches: barwise/packages/formats/src/ossie/mapOssieToOrm.ts,
barwise/packages/formats/src/ossie/writeOssie.ts,
barwise/packages/formats/tests/OssieImportFormat.test.ts,
barwise/packages/formats/tests/OssieExportFormat.test.ts,
barwise/packages/formats/tests/OssieVerify.test.ts,
barwise/packages/cli/tests/importerIds.test.ts,
barwise/docs/specs/ossie-ontology-format.spec.md,
barwise/docs/specs/identifier-roles-mandatory.spec.md

When an Ossie concept names its preferred identifier with `identify_by`,
the importer shall make each identifying role mandatory, as it already
makes it unique. The exporter keeps writing such a mandatory into
`requires`, as it does today, so the document still says it. When a
model's identifying role is optional, the export says that it will read
back mandatory.

Today an identifying role is mandatory only when the ontology also lists
it in `requires`. The only Ossie example never does: 0 of the 15
identifying relationships in the pinned `flights.ontology.yaml` appear in
`requires`, including on `Airport`, which uses `requires` for two other
roles. So importing it gives 12 `completeness/preferred-identifier-optional`
diagnostics, one per identified concept.

## Principle

Define errors out of existence on the way in, and stay explicit on the way
out. A preferred identifier names every instance of its entity, so ORM
requires its roles to be mandatory, and the Ossie example leaves that
unstated. Reading `identify_by` as implying it removes the 12
diagnostics at the source. On export, the pinned schema says nothing
about `identify_by` implying anything. So barwise keeps declaring the
mandatory rather than assuming another reader shares its inference.

The rule is decided once. The importer and the exporter's loss prediction
both call one function, built on core's own `identifyingRoles` and
`isMandatoryAlone`, which are what the diagnostic checks.

## Observed today (at 6e6e631f)

- `mapOssieToOrm` (`formats/src/ossie/mapOssieToOrm.ts`) calls
  `addIdentifier` before `addMandatoryRoles`.
  - `addIdentifier` adds the uniqueness `identify_by` implies, with a
    warning, and stores the preferred identifier. It adds no mandatory.
  - `addMandatoryRoles` adds a mandatory on a relationship's first role
    for each bare `Concept.rel` in `requires`, without checking for one
    already there.
- `writeOssie` writes a mandatory first role as `Concept.rel` in the
  concept's `requires`, through the `addMandatory` callback. That
  includes identifying roles: the shop-model test at
  `OssieExportFormat.test.ts:221` pins `Customer.customer_has_customernr`
  in `requires`. The writer predicts no loss for an identifying role that
  is optional.
- Core's `identifyingRoles(at)` gives an identifier's roles:
  - for an external uniqueness, each component's near role;
  - for an internal one, the role it leaves uncovered.

  `isMandatoryAlone(ft, roleId)` says whether a role carries an alethic
  mandatory. `completeness/preferred-identifier-optional` reports where
  the second is false for one of the first.
- The read-back check (barwise-5bv) counts a loss line on a fact type as
  covering every difference on it. So it cannot be relied on to report an
  added mandatory on a fact type that already has a loss line.
- The CLI's `importerIds.test.ts` imports an Ossie fixture whose `Party`
  has `identify_by: [ code ]` and `requires: [ Party.code ]`.
- `identifier-roles-mandatory.spec.md` says the 12 flights warnings "are
  accurate to the source" and defers the question to barwise-3ik.
- The flights round-trip test compares documents by meaning, with each
  `requires` list as a set.

## Scope

- `impliedMandatoryRoles(at)`, exported from `mapOssieToOrm.ts`, shall
  return the roles of an identifying uniqueness that carry no mandatory of
  any modality, each with its fact type. It is built on
  `identifyingRoles`. A deontic mandatory is excluded because it is not
  optional: `writeOssie` writes it to `requires`, and the read-back check
  reports that it comes back alethic.
  - The importer passes the identifier it stored. It produces no deontic
    constraints, so "no mandatory" and "not `isMandatoryAlone`" agree
    there.
  - The writer passes the identifying uniqueness it already resolved when
    deciding to write `identify_by`: `resolved.at` for a stored
    identifier, and `resolvedExt.at` (`externalIdentifies`) for an
    external uniqueness on an entity with none. It rebuilds nothing.
- After `addMandatoryRoles`, the importer shall add an alethic mandatory
  on each role `impliedMandatoryRoles` returns. Because it runs after
  `requires` is read and asks whether a mandatory is already there, a
  relationship that is both identifying and in `requires` gets one
  mandatory.
  - It shall not warn, for the reason in Open decision 2.
- `writeOssie` shall keep writing a mandatory identifying role into
  `requires`, as today.
- When `impliedMandatoryRoles` returns a role for the identifier an entity
  is written with, `writeOssie` shall predict a loss on that
  fact type: `the <Entity> role is optional; Ossie's identify_by makes it
  mandatory on import`. The prediction does not rely on the read-back
  check, which a fact type's other loss lines can silence.

Out of scope:

- The uniqueness warnings `addIdentifier` already writes.
- Deontic mandatory roles. Ossie has no modality, and the read-back
  check reports them.

## Workstreams

### 1. Read the mandatory in, and say when it was not there

The changes above. Each item below is pinned by a test:

- Importing a concept with `identify_by` over one relationship gives one
  alethic mandatory on its first role.
- The same holds for each relationship of a composite `identify_by`.
- The CLI fixture's `Party`, with `identify_by` and `requires` on the
  same relationship, gets one mandatory, not two.
- Importing the pinned flights example gives no
  `completeness/preferred-identifier-optional` diagnostic. It gives 12
  today.
- Exporting the imported flights example writes the identifying
  relationships into `requires` and no loss line. The "comes back equal
  by meaning" test treats `C.rel` in `requires` as implied when `rel` is
  in `C`'s `identify_by`, which is the reading this spec adopts. That
  test's `meaning` function changes to say so.
- A model whose identifying role is optional, on a fact type that
  already has another loss line, exports with the prediction line.
- The shop-model test's `requires` assertion is unchanged.

Measured before implementation, with a scratchpad script over the 84
tracked models that load: 378 entities have a stored identifier, and
none has an identifying role without a mandatory. So the prediction
line fires on no tracked model. Implementation re-measures it through
the export.

Doc edits:

- `identifier-roles-mandatory.spec.md`: its flights note gains "Since
  decided: barwise-3ik".
- The Ossie spec's import section states the reading.

## Open decisions

1. **Read `identify_by` as implying mandatory on import?**
   - (a) Yes (recommended). This matches ORM's reference-scheme rule and
     how the only Ossie example is written, and it removes 12
     diagnostics.
   - (b) No, leave the diagnostics. The model stays exactly what the
     source states, but every identified concept keeps a diagnostic the
     source author would not recognize.

   Recommend (a). The cost is a hypothetical ontology that means an
   identifier some instances lack, which barwise cannot model anyway.
2. **Warn when the mandatory is added?**
   - (a) No warning (recommended). On the only example it would be 12
     identical lines, and a warning on every identified concept teaches
     readers to skip warnings.
   - (b) One warning per concept. This is explicit, but it is noise.

   Recommend (a), with the reading stated in the Ossie spec's import
   section.
3. **On export, write the implied mandatory or leave it out?**
   - (a) Write it (recommended). This keeps today's output and states
     the mandatory to readers that do not share barwise's reading. The
     cost is that the flights round trip now differs by meaning-equal
     `requires` entries, which the comparison normalizes.
   - (b) Leave it out. The flights document round-trips exactly, but
     another reader following the schema literally sees an optional
     identifier, and the writer carries a copy of the importer's rule.

   Recommend (a).

## Risks and testing

- Import: an ontology that lists an identifying relationship in
  `requires` imports as before, with one mandatory. One that does not
  now gets a mandatory it did not state, which is the point.
- Export of a native model: output is unchanged, apart from the
  prediction line for an optional identifying role, which fires on none
  of the 84 tracked models.
- Export of an imported Ossie document: it gains a `requires` entry for
  each identifying relationship, because the import now holds that
  mandatory. The flights test (`OssieExportFormat.test.ts`, "comes back
  equal ... compared by meaning") absorbs this through the `meaning`
  change in Workstream 1.
