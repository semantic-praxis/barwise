# Reading recorded evidence: `prompt rescore` and `prompt compare`

Status: Draft for review
Created: 2026-08-29
Last-updated: 2026-08-29
Tracking: barwise-893 (`prompt compare`), and the reification review of
2026-08-29. Evidence: eight documents describe an offline re-score as a
procedure and nothing implements it; three baseline appendices report its
output as fact.

## Principle

**Two operations that decide what we believe are performed by hand.**
Both read evidence already on disk, both are pure functions of it, and
neither exists as code.

The first is the **offline re-score**: take a recorded round's payloads,
score them under the current build, and report what moved. It is how a
scorer change is judged, and it has run three times in two days --
written from scratch as a throwaway each time. Its outputs are quoted as
findings: "11 payloads rise, none falls, 104 unchanged" at 2.7.0, "40 of
115 fall, none rise, mean -0.131" at 2.8.0. Nobody can re-derive either
number, so both are assertions wearing the clothes of measurements.

The second is the **comparison**: take two recorded rows, subtract, and
say whether the gap is resolvable. `runSuite` already prints "gaps below
X are not resolvable" and then leaves the operator to do the subtraction
(barwise-893).

This is the determinism pillar pointed at the reader rather than the
code. Both operations are deterministic -- same payloads, same answer --
and being deterministic is worth nothing while the only implementation
is a person retyping it. The house rule that a finding is not closed by
a document applies to a _method_ just as it does to a defect: an
unexecutable procedure decays, and its recorded outputs decay with it.

## Scope (EARS)

- When given a directory of recorded payloads, the system shall score
  each against its declared eval case and report per-payload, per-arm and
  per-case results.
- When given a previously saved rescore result, the system shall report
  which payloads rose, fell and were unchanged, and refuse to diff
  results whose payload sets differ.
- When a payload's case is not declared in the suite manifest, the system
  shall name the file and the case and fail, rather than skip it.
- When rescoring, the system shall report the suite version it scored
  under **and** the version the round was recorded at, because crossing
  versions is the point of the command rather than an error.
- When given two history rows, the system shall report suite and per-case
  deltas, each with a resolvable or unresolved verdict computed from the
  recorded dispersions.
- When two selected rows carry different `suiteVersion`, `compare` shall
  refuse, naming both versions.
- Neither command shall make a network call, read a clock, or write to
  history.

## What this does not decide

- The payload retention policy, the runner, or the record layout. This
  reads what `eval-runner.sh` and `runSuite` already write.
- Whether a round's _logs_ agree with its payloads. The 2026-08-28
  freshness audit compared per-sample log lines against payload bytes;
  that is a different artifact and a different question.
- Any judgement. The commands do arithmetic and attribution; which cell
  matters and why stays human, as the 2.6.0 baseline's own analysis
  section shows.

## Design

**Both live in `@barwise/promptlab`, with the CLI as a thin wrapper.**
They are pure over recorded inputs, which is the promptlab side of the
determinism line; the CLI supplies paths and formats. `scoreExtraction`,
`dispersionOf` and `marginOfError` already exist and are the whole
computation -- neither command introduces arithmetic of its own, which is
what keeps the resolvability verdict here identical to the one
`runSuite` prints.

**`rescore` crosses suite versions on purpose; `compare` refuses to.**
The asymmetry is the design, not an inconsistency. A re-score exists to
answer "what would this round have scored under today's rules", so
refusing a version mismatch would refuse its only use; it reports both
versions instead. A comparison of two recorded means across a version
bump is the incomparability the `suiteVersion` field exists to mark, so
it refuses.

**The before/after workflow is two runs and a diff**, not a magic
double-build. `rescore --json > before.json`, land the scorer change,
`rescore --baseline before.json`. Stating this is half the point: the
alternative -- a command that checks out and builds two revisions -- would
put git and the build system inside a deterministic reader.

**The payload filename gets one owner, in promptlab.** Today the
convention lives in the CLI: `writeCasePayloads` builds
`` `${c.caseId}-run${index + 1}.json` `` at
`packages/cli/src/commands/prompt.ts:759`. A reader in promptlab that
parsed that name would be a must-agree copy across a package boundary --
rename the writer and the reader silently stops finding payloads, or
worse, mis-attributes them to the wrong case. So WS1 moves the pair into
promptlab as `payloadFileName(caseId, index)` and `parsePayloadFileName`,
and the CLI calls the first. One module then owns the shape, a round-trip
test pins the pair, and no drift test is needed because there is no
longer a copy.

This is the spec's one non-additive change, and it is why WS1 touches the
CLI at all.

## Inventory

| Piece                                              | Change                                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `promptlab/src/record/payloadName.ts`              | new: `payloadFileName` / `parsePayloadFileName`, the one owner of the convention                             |
| `cli` `writeCasePayloads` (prompt.ts:759)          | calls `payloadFileName` instead of building the name inline                                                  |
| `promptlab/src/record/rescore.ts`                  | new: directory -> per-payload scores, and the diff of two such results                                       |
| `promptlab/src/record/compare.ts`                  | new: two `HistoryEntry` rows -> suite and per-case verdicts                                                  |
| `promptlab/src/index.ts`                           | exports both                                                                                                 |
| `cli/src/commands/prompt.ts`                       | `rescore` and `compare` subcommands, text and json output                                                    |
| `scoreExtraction`, `dispersionOf`, `marginOfError` | untouched -- reused, not reimplemented                                                                       |
| `HistoryEntry`                                     | untouched; it already carries per-case mean, sd, samples and penalties                                       |
| capability matrix                                  | no new row: both are `prompt` subcommands, and the `prompt` row is already CLI-only, deliberate, dev tooling |

## Workstreams

1. **The filename owner, then `rescore` over a directory.** Move
   `payloadFileName` / `parsePayloadFileName` into promptlab and have the
   CLI writer call it; then walk the tree, pair each payload with
   its case through the manifest, score, and emit per-payload results
   with per-arm and per-case rollups. Acceptance: when a payload names a
   case the manifest does not declare, the command shall fail naming both;
   when a name is round-tripped through the pair, it shall yield the case
   id and index it was built from; when run twice on an unchanged tree,
   the two results shall be byte-identical.
2. **`rescore --baseline`.** Diff two saved results: rose, fell,
   unchanged, with magnitudes. Acceptance: when the two results cover
   different payload sets, the command shall refuse rather than diff the
   intersection silently -- a partial diff is how a re-score would
   understate its own blast radius.
3. **`compare` over two history rows** (barwise-893). Select by
   artifact/model/split, print suite and per-case deltas with verdicts
   from the recorded dispersions. Acceptance: when the rows' suite
   versions differ, the command shall refuse naming both; when a gap is
   below the combined margin, the verdict shall read unresolved.

WS1 and WS2 are one shippable unit -- WS2 is unusable without WS1's output
format, and WS1 without WS2 leaves the operator diffing JSON by hand,
which is the status quo. WS3 is independent and could ship first; it is
ordered second because the re-score is the gap with recorded consequences.

## Open decisions

1. **Does `rescore` regenerate the baseline appendix table, or just the
   numbers?** Recommend numbers only, as JSON and a short text summary.
   Generating the markdown would put a document template in a
   deterministic reader, and the three appendices written so far each
   needed different framing -- what fell, what that means, what survives.
   The arithmetic is the reusable half; the prose is not.
2. **Should `compare` accept a payload directory as one side?** Recommend
   no, for now. It would let a re-scored round be compared against a
   recorded row -- attractive, and wrong in the same way the DSPy delta
   report's arms are: a re-score has no dispersion of its own, so a
   verdict against a row's margin would be computed from one side's
   precision and read as though it came from both.
