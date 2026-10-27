# The Ossie export checks its loss report by reading the document back

Status: Proposed

Created: 2026-10-27
Last-updated: 2026-10-27
Tracking: barwise-5bv
Touches: barwise/packages/formats/src/ossie/writeOssie.ts,
+barwise/packages/formats/src/ossie/verifyOssie.ts,
barwise/packages/formats/tests/OssieExportFormat.test.ts,
+barwise/packages/formats/tests/OssieVerify.test.ts,
barwise/packages/formats/CLAUDE.md,
barwise/docs/specs/ossie-ontology-format.spec.md

When the Ossie exporter has written a document, it shall import that
document again, compare the result with the source model element by
element, and report every difference its loss report does not already
name. Today the report is built only from predictions: the writer guesses,
one construct at a time, what `mapOssieToOrm` will read back. Three review
rounds on PR #762 each found another construct where a guess was wrong.
Reading the document back found more on the first try. Over the 84 tracked
models that load, 12 models lose a deontic mandatory constraint with no
loss line, because it comes back alethic. One model (in two copies) gains
an external uniqueness its source does not have.

## Principle

Define errors out of existence. Every per-construct guess is a copy of a
decision `mapOssieToOrm` makes, and nothing keeps the copy in step with the
importer. That is how the guesses drifted three times. Reading the document
back asks the importer itself, so a new importer rule, or a new model field,
cannot open a silent gap. The comparison is pure and deterministic, as the
writer already is.

## Observed today (at a3c329bf)

- `writeOssie` (`formats/src/ossie/writeOssie.ts`) reports a loss through
  `lose(element, what)` at about 40 sites, each predicting one importer
  behaviour. The report is a list of strings. Nothing records which source
  element a line is about, apart from the name in its text.
- `mapOssieToOrm` gives every element a fresh `generateId()` id. A
  relationship imports as a fact type named `Concept.rel`
  (`ossieFactTypeName`), and role names come back as Ossie keys.
- The writer already holds the correspondence a comparison needs:
  - each object type's written concept name (`conceptNames`);
  - each fact type's declaring concept and relationship name (`Written`);
  - each fact type's written role order (`Written.order`).
- `diffModels` (`core/src/diff`) compares two models element by element,
  every element kind included, and pairs elements by id first.
- The only round-trip test compares documents, not models, and only for
  the pinned flights example (`OssieExportFormat.test.ts`, "comes back
  equal in every construct").

Prototype, measured over the 84 of 119 tracked `.orm.yaml` files that
load. It rewrites the re-imported model's ids to the source ids through the
writer's correspondence, then runs `diffModels`:

- 82 models export.
  - `empty-model` is refused by design.
  - `validation-errors` crashes the writer (barwise-5x3, filed separately).
- After removing the renames the writer makes on purpose (fact type name,
  role names), 278 differences name an element no loss line names.
  - 182 are already reported, under an id or a spelling the prototype's
    name match missed:
    - constraints: 86;
    - populations: 48;
    - objectifications: 48.
  - 70 are an internal uniqueness that "changes" only because the written
    role order differs from the source's. Restoring role order in the
    alignment removes them. Checked on `auction.orm.yaml`,
    `OrganizationWinsListing`: the constraint is the same one.
  - 19, in 12 models, are a deontic mandatory that comes back alethic. No
    loss line names it.
  - 2, one model in two copies (`docs/auction.orm.yaml`,
    `examples/auction-project/domains/catalog.orm.yaml`), are an external
    uniqueness the import adds. No loss line names it.
  - 5 are subtype facts whose identification flag flips. These are
    already reported, as "identification through the supertype not
    written as it is"; the prototype missed the `A -> B` spelling.

## Scope

- When `writeOssie` has built the document, it shall import it with
  `mapOssieToOrm` and align the result to the source model:
  - object types by written concept name;
  - fact types by `Concept.rel`;
  - roles by written order, restored to source order.
    The aligned model shall carry the source's ids for every paired element.
- It shall then compare the source with the aligned model using
  `diffModels`. It shall disregard the fact type name, role names and
  readings, which the writer changes on purpose and Ossie has no place for.
- Every loss shall record the source element it is about: an object type,
  fact type, constraint, subtype fact, population, objectification,
  definition, or the model.
- When the comparison finds a difference on an element that no loss
  names, the writer shall add a loss line for it:
  `<element>: comes back as <the diff's change description>`. A removed
  constraint with roles shall also get a `constraintSpecs` entry, as a
  predicted constraint loss does.
- Loss text shall carry no id that the re-import minted. Two exports of
  one model shall give byte-identical text, as they do today.
- The existing predicted losses shall stay. Their text says why a
  construct was not written ("Ossie has no glossary"), which a diff cannot
  say.

Out of scope:

- Removing the predictive checks (Open decision 1).
- Writing a deontic mandatory differently. The new line reports it, and
  whether Ossie can carry it is a question for the Ossie spec.
- The writer crash on a constraint over a foreign role (barwise-5x3).

## Workstreams

### 1. Read the document back, and report what the guesses missed

The changes above. `verifyOssie.ts` holds the alignment and the
comparison; `writeOssie` calls it last. Each item below is pinned by a
test:

- A model with a deontic mandatory exports with a loss line naming it, and
  the line is absent when the writer is given the alethic form.
- A model whose preferred identifier re-imports with an added external
  uniqueness gets a line for the added constraint.
- A fact type written in a different role order, with no other loss, adds
  no line.
- A deliberate rename (fact type, role names) adds no line.
- An element with a predicted loss gets no second line for the same
  element.
- Exporting the same model twice gives identical text.
- With the comparison removed, the first two tests fail.

These are measured and recorded here rather than pinned by a test:

- The corpus count of new lines. The prototype predicts 21 (19 + 2) once
  role order is restored.
- Export time over the corpus, before and after.

## Open decisions

1. **Backstop, or replace the guesses.**
   - (a) Backstop (recommended): keep every predicted loss and add the
     lines the comparison finds that no prediction covers. Messages keep
     their reasons, and the report can only grow.
   - (b) Replace: delete the predictions and report only differences. The
     drift-prone code goes, but a line like "Ossie has no glossary"
     becomes "definition X: removed", which no longer says why.
   - (c) Backstop now, then delete each prediction whose difference the
     comparison reports with an equally clear message, one at a time with
     the corpus count unchanged.

   Recommend (a), with (c) as a later issue. The backstop delivers the
   issue's guarantee, that no divergence goes unreported, without losing
   any explanation.
2. **How a difference counts as already reported.**
   - (a) By element (recommended): any loss on the same source element
     covers every difference on it. This is simple, but a second, unrelated
     difference on an element that already has a loss stays silent.
   - (b) By element and change kind: each predicted loss also names the
     change kinds it explains. This is precise, but it brings back a
     hand-kept copy, the predicted mapping from loss to change kind.

   Recommend (a), and record in the corpus measurement how many elements
   carry both a predicted loss and an unexplained difference of another
   kind. If that number is not zero, the measurement says so and (b)
   becomes a follow-up issue.
3. **What to compare with.**
   - (a) `diffModels` over the aligned re-import (recommended): it already
     covers every element kind and field, and a new model field gets
     compared without touching this code.
   - (b) A comparator written for Ossie: it can ignore the deliberate
     renames directly, but it is one more hand-kept list of fields, the
     drift this issue exists to remove.

   Recommend (a). Its cost is the alignment step, about one screen of
   code.

## Risks and testing

- Each export now runs an import and a diff. The prototype ran both over
  all 84 models in a few seconds. The measurement records the cost.
- If the alignment pairs an element wrongly, a correct export gets a false
  loss line. The role-order test and the rename test pin the two known
  sources of false lines. The corpus count is checked by hand against the
  prototype's 21.
- `mapOssieToOrm` mints ids through the global `generateId`. The
  comparison must not leak them into loss text, which the
  determinism test pins.
