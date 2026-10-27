# The Ossie export checks its loss report by reading the document back

Status: Implemented

Created: 2026-10-27
Last-updated: 2026-10-27
Tracking: barwise-5bv
Plan-reviewed: 6664a497 (code-review, pr-review)
Touches: barwise/packages/formats/src/ossie/writeOssie.ts,
barwise/packages/formats/src/ossie/OssieExportFormat.ts,
+barwise/packages/formats/src/ossie/verifyOssie.ts,
barwise/packages/formats/tests/OssieExportFormat.test.ts,
+barwise/packages/formats/tests/OssieVerify.test.ts,
barwise/packages/formats/CLAUDE.md,
barwise/docs/specs/ossie-ontology-format.spec.md

When the Ossie exporter has written a document, it shall read the written
text back through the Ossie importer, compare the result with the source
model, and add a loss line for every element that comes back different and
that no loss line names yet. Today the report is built only from
predictions: the writer guesses, one construct at a time, what
`mapOssieToOrm` will read back. Three review rounds on PR #762 each found
another construct where a guess was wrong. Reading the document back found
two more on the first try, across the 84 tracked models that load:

- 19 deontic mandatory constraints, in 12 models, come back alethic with no
  loss line.
- In one model (two copies), object type `Model` comes back with a
  preferred identifier the source does not store, again with no loss line.

## Principle

Define errors out of existence. Every per-construct guess is a copy of a
decision `mapOssieToOrm` makes, and nothing keeps the copy in step with the
importer. That is how the guesses drifted three times. Reading the document
back asks the importer itself, so a new importer rule, or a new model
field, cannot make an element come back different without a line naming
it.

The guarantee is per element, not per change. An element that already has
a predicted loss line gets no second line for a further difference (Open
decision 2).

## Observed today (at a3c329bf)

- `writeOssie` (`formats/src/ossie/writeOssie.ts`) reports a loss through
  `lose(element, what)` at about 40 sites, each predicting one importer
  behaviour. The report is a list of strings. Nothing records which source
  element a line is about, apart from the name in its text.
  - An internal constraint's loss is reported under its fact type
    (`fact type <name>`).
  - An external constraint's loss is reported under `constraint <id>`.
- `OssieExportFormat.export` stringifies the document with `yaml` and puts
  the loss lines in a comment block above it.
- `mapOssieToOrm` gives every element a fresh `generateId()` id, which
  advances the global generator. A relationship imports as a fact type named
  `Concept.rel` (`ossieFactTypeName`). Role names come back as Ossie keys.
  Readings are written as `verbalizes` and read back.
- The writer already holds the correspondence a comparison needs:
  - each object type's written concept name (`conceptNames`);
  - each fact type's declaring concept and relationship name (`Written`);
  - each fact type's written role order (`Written.order`).
- `diffModels` (`core/src/diff`) pairs elements by id first. It reports
  internal constraints inside the fact type's delta, not as deltas of
  their own. It gives added and removed deltas empty `changeDescriptions`.
  Its labels read names from the incoming model.
- `writeDocument` (core root export) turns a model into its 3.0 document;
  `OrmYamlSerializer.deserialize` reads one back from YAML. Core has no
  call that re-ids a model.
- The only round-trip test compares documents, not models, and only for
  the pinned flights example (`OssieExportFormat.test.ts`, "comes back
  equal in every construct").

### Prototype

Measured over the 84 of 119 tracked `.orm.yaml` files that load, with
scratchpad scripts outside the repository. The script:

1. imports the written document with `mapOssieToOrm`;
2. puts each fact type's roles back in source order and renumbers its
   reading placeholders to match;
3. replaces each re-imported id with its source id across the serialized
   YAML;
4. runs `diffModels` against the source.

Results:

- 82 models export.
  - `empty-model` is refused by design.
  - `validation-errors` crashes the writer (barwise-5x3, filed
    separately).
- Importing the same document twice gives no difference, so the
  comparison is stable.
- Readings compare equal in all 82 models once roles are back in source
  order. Without the reordering, 144 fact types appear to change their
  readings, and 70 appear to change an internal constraint. Restoring role
  order is therefore part of the comparison, not a refinement of it.
- Every difference the diff finds is on an element some loss line names,
  except:
  - the 19 deontic mandatories;
  - the preferred identifier on `Model` in `docs/auction.orm.yaml` and
    `examples/auction-project/domains/catalog.orm.yaml`.

  The writer writes that identifier as `identify_by` on purpose
  (`external-preferred-identifier.spec.md`). The new line makes the
  addition visible; it does not change what is written.
- The prototype decided "names the element" by matching the element's
  name as a substring of a loss line, which is looser than the rule below.
  So the corpus result under the real rule is a measurement of WS1, not a
  number this spec predicts.

## Scope

- `OssieExportFormat.export` shall stringify the document body, then read
  that text back with `OssieImportFormat.parse`, the path a user's import
  takes. It shall then call `verifyOssie` with the source model, the
  re-imported model and the writer's correspondence, and write the comment
  block from the predicted losses followed by the verified ones.
- When the read-back throws, the export shall still return the document,
  with one loss line: `model: the document does not read back:
  <importer message>` (Open decision 3).
- `verifyOssie` shall build an aligned copy of the re-imported model:
  - Fact type: roles put back in source order, reading placeholders
    renumbered to match, and the source fact type's name and role names.
  - Every re-imported object type, fact type and role id: replaced by its
    source id.

  It builds the copy with `writeDocument`, edits the fact type entries of
  that document, stringifies it, replaces the ids in the text, and reads
  it back with `OrmYamlSerializer.deserialize`. Replacing a mapped id over
  the text needs no list of the fields that hold it, because every minted
  id is a UUID that occurs only where the model refers to that element.
- Only object types, fact types and roles are paired by id. Everything else
  keeps its minted id, and `diffModels` pairs it the way it pairs a fresh
  LLM import against its base:
  - constraints by content key, which reads role ids, now the source's;
  - subtype facts by their two ends;
  - definitions by term.

  The prototype relies on the same pairing. Importing one document twice,
  with every id fresh, gives no difference, and the 70 constraint
  "changes" vanish once role ids and order are the source's.
- It shall compare the source with the aligned copy using `diffModels`.
  Nothing is filtered out: names, role names and role order already agree,
  so any difference is real.
- A delta is keyed by its source side: the source element of a modified or
  removed delta. An added delta has no source side, so no predicted loss
  covers it and it always gets a line.
- Each loss shall record the element it is about, as the diff keys them:
  - an object type, a fact type (internal constraints included), an
    external constraint, a subtype fact, a population, an objectification
    or a definition, each by source id;
  - or the model.
    The writer's `lose` calls gain that key; their text is unchanged.
- When the diff finds a delta on an element no loss names, `verifyOssie`
  shall add one line for it:
  - a modified element: `<element>: comes back changed: <change
    descriptions>`;
  - a removed element: `<element>: does not come back`;
  - an added element: `<label>: comes back added, though the model does
    not have it`.

  A removed external constraint with roles also gets a `constraintSpecs`
  entry, as a predicted constraint loss does.
- Loss text shall carry no id the re-import minted. Labels come from the
  aligned copy, which carries source names and source ids. An id
  alignment cannot map (a constraint or subtype fact the re-import added)
  shall be written as its kind and roles, never as the id.
- The check runs on the export path. `OssieExportFormat` is the only
  caller of `writeOssie`, which stays the pure writer and does not verify.
- The existing predicted losses stay, with their text. They say why a
  construct was not written ("Ossie has no glossary"), which a diff cannot
  say.

Out of scope:

- Removing the predictive checks (Open decision 1).
- Writing a deontic mandatory differently. The new line reports it, and
  whether Ossie can carry it is a question for the Ossie spec.
- Reporting the importer's own warnings on the read-back.
- The writer crash on a constraint over a foreign role (barwise-5x3).

## Workstreams

### 1. Read the document back, and report what the guesses missed

The changes above. Each item below is pinned by a test:

- A model with a deontic mandatory exports with a line naming its fact
  type. The same model with the alethic form has no such line.
- A model with no stored preferred identifier, whose external uniqueness
  is written as `identify_by`, gets a line naming the entity.
- A fact type written in a different role order, with no other loss, adds
  no line.
- A fact type whose name and role names Ossie changes adds no line.
- An element with a predicted loss gets no second line.
- An export whose document does not read back still returns it, with the
  `does not read back` line. Pinned with a stubbed importer.
- Loss text contains no id that occurs only in the re-imported model.
- Exporting the same model twice gives identical text.
- With `verifyOssie` returning nothing, the first two tests fail.

Measured and recorded here rather than pinned by a test:

- Every new line over the corpus, listed and checked by hand as a real
  difference. A line that is not real is a defect in the alignment and
  is fixed before merge.
- Elements that carry both a predicted loss and a further difference of
  another kind (Open decision 2).
- Export time over the corpus, before and after.

## Implementation notes

- As planned in the revised plan. The first draft claimed the read-back
  found an external uniqueness the import adds. The high plan review
  showed that was an artifact of role order: once roles are back in
  source order, the constraint pairs, and what remains is a preferred
  identifier on `Model`. The draft also proposed ignoring readings,
  which in fact compare equal once their placeholders are renumbered.
- Each `lose` call takes a `LossKey`. An internal constraint's loss is
  keyed by its fact type, an external one's by its id, and a subtype's
  defining-rule and identification losses by the subtype fact.
- Measured over the 84 tracked models that load (82 export):
  - 23 new lines, each checked by hand as a real difference:
    - 19 deontic mandatories that come back alethic;
    - 4 preferred identifiers stored on read-back: `Model` in the two
      auction files, and `Room` in `test-plan/fixtures/external-uniqueness.orm.yaml`
      and `external-uniqueness-violation.orm.yaml`. The prototype's
      looser name match had hidden the `Room` cases.
  - 2 exports of every model give identical text.
  - Export time over the corpus went from 0.17 s writing alone to 5.3 s
    with the read-back, about 65 ms per model.
  - Open decision 2(a) silences 1 element: `Student` in
    `trial/customers/C10-university/kernel.orm.yaml` comes back with a
    preferred identifier, while its only loss line names its reference
    mode. Filed as barwise-huw.

## Open decisions

1. **Backstop, or replace the guesses.**
   - (a) Backstop (recommended): keep every predicted loss and add lines
     for what no prediction covers. Messages keep their reasons, and the
     report can only grow.
   - (b) Replace: delete the predictions and report only differences. The
     drift-prone code goes, but "Ossie has no glossary" becomes
     "definition X: does not come back", which no longer says why.
   - (c) Backstop now, then delete each prediction whose difference the
     comparison reports as clearly, one at a time, with the corpus lines
     unchanged.

   Recommend (a), with (c) as a later issue.
2. **How a difference counts as already reported.**
   - (a) By element (recommended): a loss on an element covers every
     difference on it. Simple, but a second, unrelated difference on an
     element that already has a loss stays silent.
   - (b) By element and change: each predicted loss also names the
     changes it explains. Precise, but it brings back a hand-kept mapping
     from each prediction to the changes it explains.

   Recommend (a). WS1 counts the elements where (a) is silent. If that
   count is not zero, the spec records it and (b) becomes a follow-up
   issue.
3. **A document that does not read back.**
   - (a) Return it with a loss line (recommended): no model that exports
     today starts failing, and the user is told the document is broken.
   - (b) Refuse the export: a document barwise cannot read is a writer
     bug, and refusing makes it loud. But it turns a partial export into
     none.

   Recommend (a). In the prototype all 82 documents read back.
4. **What to compare with.**
   - (a) `diffModels` over the aligned copy (recommended): it already
     covers every element kind and field, and a new model field gets
     compared without touching this code.
   - (b) A comparator written for Ossie: it could skip alignment, but it
     is one more hand-kept list of fields, the drift this issue exists to
     remove.

   Recommend (a).

## Risks and testing

- Each export now runs a YAML parse, an import, a document round trip and
  a diff. The prototype ran all of these over 82 models in seconds. WS1
  records the cost.
- If the alignment pairs an element wrongly, a correct export gets a false
  line. The role-order and rename tests pin the two known sources, and
  every corpus line is checked by hand.
- The export now advances the global id generator through the read-back,
  a side effect `writeOssie` did not have. No id it mints reaches the
  output, which the id test pins, and nothing reads the generator's
  sequence. So the side effect is accepted rather than worked around with
  a swapped generator.
