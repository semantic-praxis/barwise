# Record what the pipeline changed and what it could not fix

Status: Draft (design proposal -- not implemented)
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-836, extending barwise-815 (workstream 1 shipped the
call log; nothing writes to it). Prompted by a review question this
session could not answer from the record: did the ring-player fix move
the recorded baseline?

## Principle

Orthogonality, and it decides the shape rather than merely endorsing it.

The obvious fix -- hang `corrections` on `DraftModelResult`, where the
data already passes through -- is wrong, and wrong in a way worth
naming. `DraftModelResult` answers "what model did this transcript
produce, and where did each part come from". Conformance corrections
answer "what did a cleanup pass change in the payload". Those are
different questions with different lifetimes, and merging them widens
the interface without removing anything a reader has to think about:
the shallow-module trade the house rules warn against.

The type is in fact already carrying the smell. `modelUsed`, `usage`,
and `latencyMs` are call telemetry, not extraction results, and they sit
on `DraftModelResult` today. `withCallLog` exists precisely because that
is the wrong home for them -- workstream 1 built the right home and left
the wrong one standing. Adding corrections would make it three unrelated
concerns on one type, so the correction is not "put it somewhere else
too" but "this is what `observe/` is for".

## A count cannot become work; a named rule can

The second requirement is that gaps get tracked, and it constrains the
record more than it first appears.

Every number this session could not act on was an aggregate. The history
row says a case had two validation errors and cannot say which rules;
`renderPenalties` prints `errors=2`; nothing anywhere names them. So
"did the ring fix help" was unanswerable -- not because the run was not
measured, but because the measurement was summed before it was stored.

`warningsByRule` is the shape that works, and it exists only for
warnings, which cost 0.05. Errors cost 0.1 and get a bare count. The
more expensive signal is the less diagnosable one.

The rule this sets: **an observation records the identity of what
happened, never only its multiplicity.** A record naming
`constraint/ring-different-players` can be filed, assigned, and closed.
A record saying `errors: 2` can only be worried about.

## Two moments, not one

Extraction does not validate. `processTranscript` runs conformance and
the parser and returns; `ValidationEngine` is constructed at thirteen
separate call sites, all downstream and later. So there are two distinct
events and a record pretending they are one would be half-empty
depending on who emitted it:

| Moment     | Emitter                 | What it knows                                                  |
| ---------- | ----------------------- | -------------------------------------------------------------- |
| Extraction | `processTranscript`     | corrections by category, parser skips, constraint `skipReason` |
| Validation | whoever runs the engine | diagnostics by `ruleId` and severity                           |

Keeping them separate is what lets the second be emitted by surfaces
that never extract at all -- `barwise validate` on a hand-written model
is exactly as worth recording as one that came from a transcript.

## Scope

In scope:

- `observe/` shall gain a record for what conformance changed, carrying
  each correction's **category** and element, not a count.
- `observe/` shall gain a record for what validation found, carrying
  each diagnostic's **`ruleId`** and severity, not a count.
- `processTranscript` shall accept a sink and emit the extraction-time
  record; the pipeline computes, the caller supplies the I/O, as the run
  date and build provenance already do.
- The scorer shall record errors by rule as it already records warnings
  by rule, closing the asymmetry.
- Nothing shall be added to `DraftModelResult`.

Out of scope, deferred and named:

- **Moving `modelUsed`/`usage`/`latencyMs` off `DraftModelResult`.**
  They belong in `observe/` by this same argument, but removing them is
  a breaking change to a type three surfaces read, and it is not what
  this spec is for. Named so the inconsistency is deliberate rather
  than unnoticed.
- **A unified event bus, log levels, rotation.** barwise-815 already
  rules these out: no dashboards, no remote collection, no background
  process. A JSONL file the operator can delete is the whole design.
- **Auto-filing issues from records.** Tempting and wrong: a rule that
  fires on every run would open an issue on every run. What the record
  enables is a periodic review that produces a few real issues, which
  is a human judgement about a tally, not a trigger.

## What must never be recorded

Inherited from barwise-815 and restated because "log everything" is the
natural reading of the request that must not be taken: **no prompt text
and no response text, ever, under any flag.** Transcripts are client
material, and a telemetry file quietly accumulating the ones users feed
it is that mistake written to disk and forgotten. Records carry
categories, rule ids, counts, sizes, and identities.

The corollary is that a correction's `description` -- prose that quotes
the constraint's own description, hence transcript-derived wording --
is **not** what gets stored. The `category` and the element name are.

## Inventory

| Area                                     | Current state                                | Verdict  |
| ---------------------------------------- | -------------------------------------------- | -------- |
| `llm/src/observe/callLog.ts`             | Complete, tested, zero call sites            | none     |
| `llm/src/observe/` (new record)          | Does not exist                               | add      |
| `llm/src/TranscriptProcessor.ts`         | Flattens corrections to `warnings: string[]` | modify   |
| `llm/src/ExtractionTypes.ts`             | `DraftModelResult`                           | **none** |
| `promptlab/src/score/scoreExtraction.ts` | `warningsByRule`, no `errorsByRule`          | modify   |
| `promptlab/src/history/history.ts`       | `penalties.errors` is a bare count           | modify   |

## Risks and testing

- **Recording that changes behaviour.** `withCallLog` already sets the
  rule -- a throwing sink is swallowed, because observability that can
  fail the operation it observes is worse than none. The new emitters
  follow it, asserted the same way.
- **The flattened prose is load-bearing.** Surfaces render
  `warnings: string[]` to users today, and conformance descriptions are
  in it. Emitting structured records must not remove those strings, or
  a user stops being told their constraint was dropped. Additive only.
- **An asymmetric fix.** Adding `errorsByRule` without also recording it
  in history repeats the original defect one level up. Both, or
  neither.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No change to any validation rule or conformance check.
- No change to the scoring weights.
- No prompt change.
