# An Ossie identifier makes its roles mandatory

Status: Proposed

Created: 2026-10-27
Last-updated: 2026-10-27
Tracking: barwise-3ik
Touches: barwise/packages/formats/src/ossie/mapOssieToOrm.ts,
barwise/packages/formats/src/ossie/writeOssie.ts,
barwise/packages/formats/tests/OssieImportFormat.test.ts,
barwise/packages/formats/tests/OssieExportFormat.test.ts,
barwise/docs/specs/ossie-ontology-format.spec.md

When an Ossie concept names its preferred identifier with `identify_by`,
the importer shall make each identifying role mandatory, as it already
makes it unique. The exporter shall then leave that mandatory implied,
not write it into `requires`.

Today an identifying role is mandatory only when the ontology also lists
it in `requires`. The only Ossie example never does: 0 of the 15
identifying relationships in the pinned `flights.ontology.yaml` appear in
`requires`, including on `Airport`, which uses `requires` for two other
roles. So importing it gives 12 `completeness/preferred-identifier-optional`
warnings, one per identified concept. Each says the model lacks something
the source evidently meant.

## Principle

Define errors out of existence. A preferred identifier names every
instance of its entity, so ORM requires its roles to be mandatory. The
Ossie example shows authors writing `identify_by` and leaving the
mandatory unstated. Reading `identify_by` as implying the mandatory makes
the 12 warnings disappear at the source rather than asking every user to
dismiss them. It is the same reading the importer already applies to
uniqueness.

## Observed today (at 6e6e631f)

- `addIdentifier` (`formats/src/ossie/mapOssieToOrm.ts`):
  - For one identifying relationship, it adds the far role's uniqueness
    when the multiplicity did not state it, with a warning. It adds no
    mandatory.
  - For several, it adds each near role's uniqueness the same way, then
    the external uniqueness. Again it adds no mandatory.
- `addMandatoryRoles` adds a mandatory on a relationship's first role for
  each bare `Concept.rel` in `requires`.
- `writeOssie` writes a mandatory first role as `Concept.rel` in the
  concept's `requires`, through the `addMandatory` callback in
  `writeRelationship`. It writes one for an identifying role as well.
- The pinned Ossie schema describes `identify_by` as "names of
  relationships to use as the preferred identifier of this concept". It
  says nothing about mandatory roles either way.
- Since barwise-5bv, the export reads its document back and reports any
  element that comes back different with no loss line naming it.

## Scope

- When a concept has `identify_by`, the importer shall add a mandatory on
  the first role (the concept's own role) of each relationship it names,
  unless one is already there.
  - It shall not warn when doing so. The 12 warnings this replaces were
    noise on the only real example, and a warning that fires on every
    identified concept teaches readers to skip warnings (Open decision 2).
- When a mandatory first role belongs to a relationship the concept's
  `identify_by` names, `writeOssie` shall not write it to `requires`. It
  is implied, and it reads back as the same mandatory.
- A source model whose identifying role is not mandatory exports as
  before. The read-back check (barwise-5bv) then reports that the role
  comes back mandatory, which is the truth.

Out of scope:

- The uniqueness warnings `addIdentifier` already writes.
- Deontic mandatory roles. They are already reported by the read-back
  check, because Ossie has no modality.

## Workstreams

### 1. Read the mandatory, and leave it implied on the way out

The changes above. Each item below is pinned by a test:

- Importing a concept with `identify_by` over one relationship gives a
  mandatory on its first role.
- The same holds for each relationship of a composite `identify_by`.
- A concept that also lists the relationship in `requires` gets one
  mandatory, not two.
- Importing the pinned flights example gives no
  `completeness/preferred-identifier-optional` diagnostic. It gives 12
  today.
- Exporting the imported flights example writes no `requires` entry the
  source did not have. The existing "comes back equal" test covers this.
- A model whose identifying role is optional exports with the read-back
  line naming the added mandatory.

## Open decisions

1. **Read `identify_by` as implying mandatory?**
   - (a) Yes (recommended). This matches ORM's reference-scheme rule and
     how the only Ossie example is written. It removes 12 warnings, and
     the flights example still round-trips.
   - (b) No, leave the warnings. The model stays exactly what the source
     states, but every identified concept keeps a validation warning the
     source author would not recognize as a problem.

   Recommend (a). The one cost is a hypothetical ontology that means an
   identifier which some instances lack. ORM has no such identifier, and
   barwise could not model it anyway.
2. **Warn when the mandatory is added?**
   - (a) No warning (recommended). The reading is the convention, as the
     uniqueness reading would be if multiplicities were always written.
   - (b) One warning per concept. This is explicit, but it is 12 lines on
     the only example, each saying the same thing.

   Recommend (a), with the rule stated in the Ossie spec's import
   section, where a reader looks for how Ossie maps.

## Risks and testing

An ontology that lists an identifying relationship in `requires` imports
as before (one mandatory). One that does not now gets a mandatory it did
not state. Measured by the flights test above. No other tracked file is
in Ossie format.
