# Six small tracker defects, one batch: fix each where it lives

Status: Draft -- no workstream implemented
Created: 2026-09-06
Last-updated: 2026-09-06
Tracking: barwise-858, barwise-5t9.14, barwise-857, barwise-854,
barwise-853, barwise-923 (all open; closures follow the merge)

## Principle

Each of the six is a small instance of one of the audit findings this
project keeps producing: a declared thing nothing produces (858), a
constant that should derive from the authority (5t9.14), a public
export nothing consumes (857), a ranking that cannot answer the question
it is asked (854), a guard specified and recorded but never read (853),
and a pure function that is not (923). None is worth a spec of its own;
together they are one PR read by commit. The principle at stake differs
per workstream and is named there. What they share is the batch rule
from the root `CLAUDE.md`: a finding is closed by a check or a fix, not
by a document, so each workstream lands the test that would have caught
it.

The resolution in one sentence: six independent commits, each fixing one
tracker issue in the package that owns it, each with the regression test
its issue asked for, none changing a public interface beyond what the
issue names.

## Scope

In scope, one EARS requirement per workstream:

- When `ParseLevel` is read, the system shall offer only the two tiers
  that code produces (`"sqlglot"`, `"regex"`), and the cascade
  docstrings shall describe two tiers.
- When the VS Code scaffold or `splitModel` emits an `orm_version`, the
  system shall emit `CURRENT_ORM_VERSION`, never a literal.
- When `@barwise/diagram` is imported, the system shall not export
  `computeLayoutMetrics`; the corpus tolerance test keeps consuming it
  from its module path.
- When two applicable prompt-artifact variants differ only in
  `modelPrefix` length, the system shall resolve to the longer prefix.
- When the optimizer scores a case, the system shall carry
  `elementCount` into `MetricLog`, report the per-arm mean in the delta
  report, and say so when the candidate's mean rises with its score.
- When the same `.orm.yaml` is loaded twice, the system shall return
  the same `hashModel()` for both loads.

Out of scope: the serializer's habit of minting and persisting a UUID
for every id-less constraint on save (the cause behind 923; a
non-idempotent round trip is a separate question, noted under
Non-goals); an LLM tier for the SQL cascade (858 asks where it would
live, and the answer is the connector that would call an LLM, via the
`enrich` seam already declared in `core/src/import/types.ts`); wiring
layout metrics into a user-facing report (857 offers delete as a
legitimate answer; un-exporting is the cheaper form of it).

## Inventory

| Module                                            | Current state                                                      | Verdict                                                |
| ------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------ |
| `core/src/sql/types.ts`                           | `ParseLevel` declares `"llm"`; docstring describes three tiers     | Drop the member; two-tier docstring (WS1)              |
| `core/src/sql/SqlCascadeParser.ts`                | Header lists an "LLM fallback (deferred to enrich() phase)"        | Point at `enrich` as the seam, no third tier (WS1)     |
| `vscode/src/commands/NewProjectCommand.ts`        | `PROJECT_SCAFFOLD` literal `orm_version: "1.0"`                    | Interpolate `CURRENT_ORM_VERSION` (WS2)                |
| `core/src/project/splitModel.ts:340`              | `doc.orm_version ?? "1.0"`                                         | Fall back to `CURRENT_ORM_VERSION` (WS2)               |
| `diagram/src/index.ts:38`                         | Exports `computeLayoutMetrics`, `LayoutMetrics`; no consumer       | Remove the export line (WS3)                           |
| `diagram/tests/layout/metrics.test.ts`            | Imports from `../../src/layout/metrics.js`; corpus tolerance gate  | Unchanged: it is the consumer                          |
| `llm/src/prompt/artifacts/resolveArtifact.ts:57`  | `specificity()` scores which fields are present, not prefix length | Rank by (fields, prefix length) (WS4)                  |
| `cli/tests/workspace/promptArtifacts.test.ts:134` | Pins the tie as documented-not-endorsed                            | Flip to assert the narrower prefix wins (WS4)          |
| `optimizer/barwise_optimizer/barwise_cli.py:133`  | `CaseScore` has no `element_count`; `from_json` drops it           | Carry it (WS5)                                         |
| `optimizer/barwise_optimizer/metric.py:26`        | `MetricLog` has no element counts                                  | `element_counts` list + `mean_element_count` (WS5)     |
| `optimizer/barwise_optimizer/export.py:230`       | `render_delta_report` has no denominator line                      | Per-arm mean line; a sentence when it moves with score |
| `core/src/lineage/manifest.ts:86`                 | `hashModel` hashes the serialized YAML, ids included               | Hash an id-canonical projection (WS6)                  |
| `core/src/model/FactType.ts:109`                  | Mints a fresh UUID for every id-less constraint                    | Unchanged: the mint is by design (uuid7 spec)          |
| `core/src/serialization/yaml/constraint.ts`       | Emits the minted id                                                | Unchanged                                              |

`cli/src/commands/prompt.ts:427` writes `scoreExtraction`'s result as
JSON, so `elementCount` already crosses the CLI boundary; WS5 is the
Python side only.

## Target architecture

```
WS6 -- hashModel (core/src/lineage/manifest.ts)
  serialize(model)                         deterministic except for ids
    -> YAML.parse                          the serializer's own document
    -> canonicalizeIds(doc)                every string equal to some `id`
                                           value becomes "#n", n = order of
                                           first appearance; references
                                           follow because they are equal
                                           strings, not because a key list
                                           names them
    -> JSON.stringify -> sha256            key order is the serializer's,
                                           already deterministic

WS4 -- resolveArtifact
  specificity: [fieldsPresent, modelPrefix.length]   compared lexicographically;
  a tie is now two variants with the SAME prefix, which is the authoring
  error the message already describes.

WS5 -- optimizer
  CaseScore.element_count  <- payload["elementCount"]
  MetricLog.element_counts <- record()          parallel to scores, like case_ids
  MetricLog.summary()["meanElementCount"]
  render_delta_report: "- mean element count: baseline x / candidate y"
    + "candidate produced N% more elements and scored higher: check the
       denominator" when both rise
```

## Alternatives considered

- **923: deterministic ids at load (derive from fact-type id + position).**
  Fixes the symptom for every consumer, but changes what the serializer
  writes on every first save of a hand-authored file, and the uuid7
  spec's mint-on-load is deliberate. Rejected here; noted as the
  follow-on if a second consumer needs stable ids.
- **923: strip only constraint ids before hashing.** Narrower and
  brittle: the next id-less element kind reintroduces the bug. The
  order-of-appearance canonicalization covers any id.
- **857: wire a `barwise diagram --metrics` report.** A capability with
  no requester; the issue says delete is legitimate. Un-export keeps the
  regression gate and removes the unwired surface.
- **858: keep `"llm"` with a doc pointing at the connector.** A union
  member no code produces is the defect; a comment does not fix it.
- **854: keep the tie, rewrite the message.** Leaves an operator holding
  a question they cannot answer. The issue recommends ranking; taken.

## Workstreams (each independently shippable, one commit each)

### 1. `ParseLevel` drops `"llm"` (barwise-858)

`core/src/sql/types.ts` and `SqlCascadeParser.ts` docstrings. No test
change: nothing produced or branched on the member. Core public type
narrows, so the monorepo build follows (only `@barwise/dbt` names a
`ParseLevel` literal, and it is `"sqlglot"`).

### 2. `orm_version` emit points derive from `CURRENT_ORM_VERSION` (barwise-5t9.14)

`splitModel.ts` fallback and the VS Code scaffold. Tests: a `splitModel`
case with a document lacking `orm_version` asserts the emitted version
equals `CURRENT_ORM_VERSION`; the scaffold constant is exported and a
unit test parses it and asserts the same. Both seen red on the literal
first.

### 3. Un-export `computeLayoutMetrics` (barwise-857)

Remove `diagram/src/index.ts:38`. The corpus tolerance test in
`metrics.test.ts` is the consumer and imports the module directly. A
short note in `diagram-layout-aesthetics.spec.md` records that the
metrics are internal to the gate.

### 4. Narrower `modelPrefix` wins (barwise-854)

`resolveArtifact.ts` `specificity` returns a tuple; the winner is the
lexicographic max. Tests: `llm/tests/.../resolveArtifact.test.ts` gains
"a longer prefix beats a shorter one"; `cli/tests/workspace/promptArtifacts.test.ts:134`
flips from pinning the tie to asserting `local-narrow-1` resolves.

### 5. `elementCount` reaches the delta report (barwise-853)

Python only. `CaseScore.element_count`, `MetricLog.element_counts`,
`summary()["meanElementCount"]`, one report line, and the sentence when
the candidate's mean element count rises together with its score.
Tests in `optimizer/tests/test_metric.py` and `test_export.py`, red
first. Runs as `uv run --frozen --extra dev pytest optimizer/tests -q`.

### 6. `hashModel` is deterministic across loads (barwise-923)

Canonicalize ids as sketched. Test: load `examples/models/learning-design.orm.yaml`
twice (it has 76 explicit element ids and no constraint ids) and assert
equal hashes; a second test asserts a real content change still changes
the hash. Seen red first (reproduced 2026-09-06: two loads differ on
every constraint `id:` line and nothing else).

## API and migration impact

- `@barwise/core`: `ParseLevel` narrows; `hashModel` output changes for
  every model, so every existing `.barwise/lineage.yaml` reports its
  exports stale exactly once after upgrade. That is the correct
  direction: for any model with an id-less constraint, `barwise lineage
  status` reported stale on every run before this, because the hash
  never matched across processes.
- `@barwise/diagram`: `computeLayoutMetrics` and `LayoutMetrics` leave
  the public surface. No package in the workspace imports them.
- `@barwise/llm`: `resolveArtifact` resolves cases it used to throw on.
  No signature change.
- Python lane: `CaseScore` gains a field with a default; existing
  `from_json` callers are unaffected.

## Open decisions (for review)

- **One PR or six.** Recommended: one PR, six commits, read by commit;
  each commit is green alone and a reviewer who wants a split can ask.
  The alternative is six PR bodies for six ten-line changes.
- **923: should lineage also ignore explicit id renames?** The
  canonicalization makes it so (an id rename with no other change hashes
  the same). Recommended: yes -- ids are identity plumbing, and the
  exports lineage guards are functions of names and structure. The one
  export that writes ids (NORMA XML) is the counter-case; noted, not
  guarded.
- **857: un-export versus delete.** Recommended: un-export. The corpus
  gate is the consumer the audit missed; deleting it deletes the gate.

## Risks and testing

- Each workstream: its package's `npx vitest run` (or the pytest line
  above), then `npm run build` from `barwise/` before any per-package
  `tsc --noEmit` (WS1 and WS6 change core; WS3 changes diagram).
- `npm run ci:local` before push; the duplication ratchet may fire on
  the new `splitModel`/scaffold tests naming the same constant, in
  which case the baseline row is the fix, not a comment.
- No behaviour a user relies on changes silently: WS6's one-time stale
  report is the only visible effect and is named in the PR body.

## Non-goals

- Making the serializer round trip idempotent for id-less constraints.
  `FactType.ts:109` mints, `yaml/constraint.ts` persists; the first save
  stamps ids and every later load is stable. That is the uuid7 design,
  and 923 is fixed without touching it.
- A third SQL cascade tier. If one is ever wanted it lives in the
  connector that owns the LLM call, through `ImportFormat.enrich`, and
  `ParseLevel` grows there and then -- not in core ahead of a producer.
- Any change to what `barwise prompt score` prints.
