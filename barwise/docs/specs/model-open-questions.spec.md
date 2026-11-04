# Open questions as model elements

Status: Draft -- no workstream implemented

Created: 2026-10-22
Last-updated: 2026-10-22
Tracking: barwise-vny

## Principle

Open questions become a model-level collection, `open_questions`, which the
transcript importers fill instead of writing `TODO(barwise)` comments. Only
what needs a person's answer is stored; a record of one import run goes to
the run's trail, and what the model already implies stays computed. It ships
in the format the version gate selects (`orm-format-3.spec.md`, Open decision
12). Today barwise writes
its questions into the `.orm.yaml` file as comments
(`# TODO(barwise): Ask: ...`), and its own next save erases them. Every save
goes text to model to text, and the model has nowhere to hold a question.
The comment audit of 2026-10-22 found 54 such lines in three example files,
each a real question for a domain expert ("Can an appointment exist without
a visit reason?"). A user who imports a transcript and then edits the model
in VS Code loses all of them on the first save, with no message.

A question the tool means to keep is a declared element of the model, not
text placed between the elements: explicit over implicit.

## What is a question, and what is not? (resolved: only what needs an answer from a person)

The annotator writes eight kinds of line today (`annotation/OrmYamlAnnotator.ts`,
`collectAnnotations`, :258-376). They split three ways.

| Line                                   | Comes from                             | Verdict                                                                 |
| -------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------- |
| `Ask: <ambiguity>`                     | LLM `ambiguities`                      | **question**                                                            |
| `Skipped constraint: ... -- reason`    | LLM constraint provenance, not applied | **question**: a rule the transcript stated that the model does not hold |
| `Verify constraint ... low confidence` | LLM constraint provenance              | **question**                                                            |
| `Skipped subtype: X is a Y`            | LLM subtype provenance, not applied    | **question**                                                            |
| `Applied with medium confidence: ...`  | LLM constraint provenance              | not a question: a record of one import run, kept in the run's trail     |
| Each conformance or parser warning     | LLM `warnings`                         | not a question: a record of one import run, kept in the run's trail     |
| `Ask: How do you uniquely identify X?` | core analysis (`isIdentified`)         | not stored: validation derives it from the model at any time            |
| `No definition captured for X`         | core analysis                          | not stored: validation derives it from the model at any time            |

The model states what is true about the domain and what is still undecided
about it. A record of what one tool run did is not about the domain, and it
belongs in the run's record, the `--trail` sidecar (`<model>.trail.json`).
That sidecar holds less than this needs today: `ReasoningTrail`
(`llm/src/ReasoningTrail.ts:31-54`) carries ambiguities and low-confidence
assumptions, not medium-confidence notes or warnings, and only the CLI writes
one. Workstream 2 closes both gaps, or the two kinds would vanish on every
surface without a message. Anything
the model itself implies, such as a missing identifier, is computed by
`completenessWarnings` on demand. Storing it would be a second copy that
goes stale the moment the user adds the identifier.

## Scope

In scope:

- When a transcript import produces an ambiguity, a skipped or low-confidence
  constraint, or a skipped subtype, the system shall add an open question to
  the model, naming the elements it is about where the text names them, and
  the transcript lines it came from.
- When a model with open questions is saved and loaded, the system shall keep
  every question, its status and its answer.
- When `barwise import transcript`, the MCP `import_transcript` tool or the
  VS Code transcript import writes a model, the system shall write no
  `TODO(barwise)` or `NOTE(barwise)` comment into the `.orm.yaml`.
- When a question names an element that is removed, the system shall keep
  the question and drop the reference, as the question may still stand.
- When `describe`, `query`, the VS Code sidebar or `barwise review` reads a
  model, it shall be able to see its open questions.

Out of scope:

- Questions from `barwise review`. Its suggestions are advice about modelling,
  printed and never stored; storing them is a later choice (decision 4).
- The export annotators (DDL, dbt, Avro, OpenAPI). They write comments into
  files barwise does not read back, so nothing erases them.
- Comment-preserving saves in general (filed separately).

## Inventory

Verified on 2026-10-22.

| Area                                                     | Current state                                                                                                                                                                                                    | Verdict                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `core/src/annotation/OrmYamlAnnotator.ts`                | Text-level: strips old barwise comments, inserts new ones after `name:` lines; matches elements by name substring                                                                                                | retired for `.orm.yaml`; its element matching moves to the question builder |
| `core/src/annotation/helpers.ts`                         | `formatBarwiseComment`, the strip regex                                                                                                                                                                          | kept for the export annotators                                              |
| Callers of `annotateOrmYaml`                             | `cli/.../import/transcript.ts:177` (on by default, `--no-annotate`), `import/batch.ts:146`, `mcp/src/tools/import.ts:148`, `vscode/.../ImportTranscriptCommand.ts:115`, `vscode/src/mcp/ToolRegistration.ts:241` | each adds questions to the model instead                                    |
| `llm/src/ExtractionTypes.ts` `DraftModelResult`          | Carries `ambiguities`, constraint, subtype and objectification provenance with `applied`, `skipReason`, `confidence`; `SourceReference {lines, excerpt, filePath?}`                                              | the source of every question; unchanged                                     |
| `core/src/model/Definition.ts`, `OrmModel.addDefinition` | A model-level list with no id, matched by `term` in diff and merge                                                                                                                                               | the template for the collection, but questions get ids                      |
| `core/schemas/orm-model.schema.json`                     | No source, provenance or confidence field anywhere                                                                                                                                                               | gains `model.open_questions`                                                |
| `--trail` sidecar (`ReasoningTrail.ts`)                  | Ambiguities, anchors, discarded framings, low-confidence assumptions; CLI only, and only with `--output`                                                                                                         | gains medium-confidence notes and warnings (workstream 2)                   |
| Readers of the comments                                  | None: nothing parses `TODO(barwise)` back except the strip regex                                                                                                                                                 | nothing to migrate in code                                                  |

## Target architecture

```ts
// model/OpenQuestion.ts
interface OpenQuestion {
  readonly id: string;
  /** The question, as a person should read it. */
  readonly text: string;
  /** Elements it is about: object type, fact type or constraint ids. May be empty. */
  readonly about: readonly string[];
  readonly status: "open" | "answered";
  /** What the person decided, when answered. */
  readonly answer?: string;
  /** Where it came from, when a tool raised it. */
  readonly source?: {
    /** Widened when a second producer exists (decision 4). */
    readonly kind: "transcript";
    readonly file?: string;
    readonly lines?: readonly [number, number];
    readonly excerpt?: string;
  };
}
```

```yaml
# the selected format version
model:
  open_questions:
    - id: q-visit-reason
      text: Can an appointment exist without a visit reason?
      about: [ot-appointment, ft-appointment-has-visit-reason]
      status: open
      source: { kind: transcript, lines: [15, 15] }
```

Core stores, serializes, diffs and merges questions and knows nothing about
where they came from: the LLM package builds them from a `DraftModelResult`,
so the determinism rule holds. A question is answered by editing the file or
through an editor command; the model does not act on an answer.

## Alternatives considered

- **Keep comments and make saves preserve them.** It leaves the questions
  invisible to every surface except a text editor, and matching comments to
  elements after a structural edit is the hard part of that work anyway.
- **A note on each element.** Most questions are about a relationship
  between elements, or about something the model does not contain yet ("is
  there a direct link between Appointment and ExamRoom?"). A note has one
  owner; a question may have none, one or several.
- **Store every annotation kind, as the comments do.** It turns the model into
  a log of import runs, and the derived kinds go stale. Rejected in the
  section above.

## Workstreams (each independently shippable)

### 1. The element, end to end in core

`OpenQuestion`, `OrmModel.openQuestions` / `addOpenQuestion` /
`removeOpenQuestion`, the schema, the serializer, removal cascades that drop
a removed element's id from `about`, diff (matched by id, then by text), merge
(incoming questions are additions; an answer on either side wins over open),
and split (a question goes to the domain holding everything it is about, or to
the first domain when it is about nothing, with a warning when its elements
span domains).

Acceptance: a round-trip law over questions; the cascade, diff and merge cases
above as tests; a schema drift test for the status values.

### 2. Imports write questions, not comments

`@barwise/llm` gains `openQuestionsFrom(result)`, which builds questions from
ambiguities and skipped or low-confidence constraints and subtypes, resolving
`about` by the existing name matching but storing ids. The five callers add
them to the model, and `annotateOrmYaml` is no longer called on `.orm.yaml`.
`--no-annotate` becomes `--no-questions` (decision 3). The run records the
comments carried and the model no longer holds, medium-confidence notes and
conformance and parser warnings, go to `ReasoningTrail`, which gains both: the
CLI writes them in the `--trail` sidecar, the MCP tool returns them in its
response, and the VS Code import writes them to its output channel.

Acceptance: an import from the recorded response
`llm/tests/fixtures/responses/clinic-appointments.json` yields, as model
elements, one question for each `todo` annotation `collectAnnotations` builds from
ambiguities, constraint provenance and subtype provenance, and none from
`collectStructuralGaps` (the missing-identifier and missing-definition lines,
which validation derives) or from any `note` annotation; a save and reload keeps all
of them.

### 3. Surfaces read them (provisional: not yet grounded)

- `describe` lists open questions, and its focus on an element shows the
  questions about it.
- `query` gains `list-questions [--status open|answered]`.
- The VS Code sidebar gains a Questions category, and an open question shows
  as an information diagnostic on the elements it is about.
- `barwise review` sends the open questions to the model as context.

### 4. The three annotated examples (provisional: not yet grounded)

Convert the `TODO(barwise): Ask:` lines in `examples/transcripts/*.orm.yaml`
into questions, with orm-format-3 WS5's corpus rewrite.

## API and migration impact

- A new model-level collection; no existing field changes.
- Format: the version `orm-format-3.spec.md` Open decision 12 selects.
- Behaviour change at the surfaces: a transcript import no longer writes
  comments into the file. Anyone who relied on reading them in a text editor
  sees them in the file as YAML under `open_questions` instead.
- Capability matrix: no surface gains or loses a capability; every surface
  that imports transcripts produces questions.

## Open decisions (for review)

1. **Format version.** Decided once, for this spec and its two siblings, by
   `orm-format-3.spec.md` Open decision 12.
2. **Name.** (a) Recommended: `open_questions`, which says what the list is for
   and keeps answered ones honest about what they were. (b) `questions`,
   shorter. (c) `issues`, which reads as a tracker and invites scope creep.
3. **The import flag.** (a) Recommended: `--no-questions`, and `--no-annotate`
   kept as a deprecated alias for one release. (b) Keep `--no-annotate` with
   its new meaning, which no longer describes what it does.
4. **Review suggestions as questions.** (a) Recommended: not now. Review
   output is advice from one model run and is often wrong; storing it by
   default would fill models with noise. (b) A `barwise review --save` that
   records the suggestions a user accepts.
5. **Answered questions.** (a) Recommended: kept, with `status: answered` and
   the answer, because the answer is the record of a modelling decision. (b)
   Removed on answer, which loses why the model is the way it is.

## Risks and testing

- **Name matching gets ids wrong.** The annotator matched elements by name
  substring, so "Customer" matches "CustomerOrder". Workstream 2 keeps the
  matcher, but tests pin whole-name matching on the fixture cases before
  anything is stored by id.
- **Question growth.** Each import of a transcript into the same model adds
  questions again. Merge matches by text as well as id, so a re-import adds
  nothing it already holds; a test pins this.
- **Determinism.** Core never creates a question; only the LLM package and the
  user do. The core suite needs no clock or randomness for any of this.

## Non-goals

- No workflow: no assignee, due date or priority. A question is text, its
  subjects, and its answer.
- No change to validation. An open question is not a diagnostic in the
  validation engine; the VS Code information diagnostic in workstream 3 is a
  presentation of the element.
