# A root REVIEW.md: one map of the review lanes, and the failure modes a month of reviews kept finding

Status: Implemented -- REVIEW.md, the instruction-refs gate extension, and
the pointers from the review skills land together

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-f4v

## Principle

Explicit over implicit, and a finding is not closed by a document. Four
review lanes exist -- CI, the bundled `/code-review`, `/security-review`,
and the repo's `pr-review` skill -- plus the managed Claude Code Review
service, which can be enabled per repository. Nothing says which runs
when: `pr-creation` never tells the author to run `/code-review` or
`/security-review` before opening, and `pr-review` names
`security-review` in one clause. Meanwhile the defects the reviews
actually caught between 2026-09-23 and 2026-10-23 fall into a handful of
recurring classes, and half of those classes are in no checklist, so each
was rediscovered by whichever reviewer happened to look.

`REVIEW.md` is the file the Claude Code Review service reads as its
review-only instructions (the root file, plus any `REVIEW.md` in a
directory the diff touches once the default branch is protected). It is also the natural place for a human or agent to look
for "how is this repo reviewed". This spec makes it the single owner of
two things no file owns today: the lane map, and the measured failure
modes. Everything else it points at.

## Does REVIEW.md reach the in-session reviewers? (resolved: only through pointers)

The service reads `REVIEW.md` and `CLAUDE.md`. The bundled `/code-review`
reads `CLAUDE.md` and not `REVIEW.md` (Claude Code docs, "Review locally
with /code-review", "What the review reads and edits"). The service
cannot run code or invoke skills, so a REVIEW.md that says "run
`/pr-review`" instructs nothing on its own. Three edits close the gap:

- the root `CLAUDE.md` conventions bullet on PRs names `REVIEW.md`, so
  every session, `/code-review` included, knows it exists;
- `pr-review/checklist.md` "Every PR" runs REVIEW.md's failure modes, so
  `pr-review` and the author's own pass (`pr-creation` treats the
  checklist as its output specification) both apply them;
- `pr-creation`'s readiness list names the author-side lanes.

The service has a fourth path: REVIEW.md asks it to read
`.claude/skills/pr-review/checklist.md`. `@`-includes cannot do this --
they resolve only for files beside the root REVIEW.md -- and copying the
checklist to the root would make two owners.

## Is the service running here? (resolved: no, as of 2026-10-23)

A search of the window's 183 closed PRs found no comment from the Claude
app and no `Claude Code Review` or `Claude Approvals` check run. Copilot
reviewed 106 PRs until `copilot-review.yml` was paused on 2026-10-19;
since then review has been in-session `/code-review` and `pr-review`
only. REVIEW.md is therefore useful today through the pointers above, and
becomes the service's configuration when an Owner enables it. Two
service behaviours depend on settings outside the repo: REVIEW.md is read
from the default branch, never the PR, and lowering severity, path
exclusions, the nit cap, subdirectory `REVIEW.md` files and
`@`-includes are honoured only when the default branch is protected (Claude Code docs, "Customize Code Review").

## Scope

In scope:

- When a pull request is reviewed by the Claude Code Review service, the
  service shall read the root `REVIEW.md` for the barwise severity
  calibration, evidence rules, skip list and failure modes.
- When `pr-review` runs, its checklist shall apply REVIEW.md's failure
  modes as an "Every PR" item.
- When an instruction file named `REVIEW.md` at any depth cites a path,
  `npm run check:instruction-refs` shall resolve it like any other
  instruction file's reference.

Out of scope: enabling the service and protecting `main` (an Owner's
settings, not repository content); resuming Copilot (barwise-ilb);
rewriting `.github/copilot-instructions.md`, which carries modelling
guidance rather than review guidance.

## Evidence: the failure classes, 2026-09-23 to 2026-10-23

Three passes, each read independently: the tracker (192 issues created or
closed in the window), `git log` (548 commits; 106 post-merge fixes and
32 in-review fixes read in full), and 30 PRs' review threads (144
threads). The WS6 seed pass in `tiered-pr-review.spec.md` (25 Copilot
findings) was the prior taxonomy. Classes are ranked by occurrences
times cost; each REVIEW.md rule cites its instances. The commit count
reproduces with `git log --since=2026-09-23 --oneline 1a32f9c7 | wc -l`
(548); the PR and thread counts are a one-time read through
the GitHub API on 2026-10-23 and have no command behind them, so treat
them as a snapshot of that date.

| Class                                                         | Instances (examples)                            | In checklist before   |
| ------------------------------------------------------------- | ----------------------------------------------- | --------------------- |
| Input silently dropped at a boundary, exit 0                  | c3e8bd75, b0f408dc, aaf5837c; barwise-5fg, -tn4 | no                    |
| Gate or script answers when it could not read its input       | 9edc13c9, 01f7fa66, 2e101af6, 179f405d          | in CLAUDE.md only     |
| Test that cannot fail, or pins the defect                     | e72027be, b0ec692c; barwise-1049                | partly (needs mutate) |
| Wired in one place, not its siblings; or no production caller | 74a71ad3, da360d7e, b0f408dc; barwise-vqc, -1fr | reach only            |
| Restated fact went stale (docs, tool descriptions, messages)  | 941cc09b, 43dfe061; WS6's top mode (9 of 25)    | yes, except messages  |
| Parser boundary input: quoting, case, literals                | 5aaf1fde, 18a6a8a1; barwise-yvx                 | no                    |
| ORM shape: role arity, ids assembled by hand                  | bb9b4660, 35ee5c4a; barwise-nkq                 | no                    |
| PR description claims behaviour the code lacks                | barwise-tms (#577); WS6 5 of 25                 | numbers only          |

Classes found only by execution (stale `dist` or turbo cache, GitHub API
behaviour, toolchain drift, timing) are left out of REVIEW.md: a reviewer
reading a diff cannot settle them, and CI or `ci:local` already does.

False positives, from the same threads, set the evidence rules: a finding
against one site of a convention the module applies everywhere (#625), a
re-raised decision the PR or spec had already recorded (#662, #570), a
finding about code that does not exist (#672, #534), and a cost asserted
rather than measured (#672). Copilot's non-convergence -- new findings on
unchanged lines in round after round, 10 to 13 rounds on #621 and #662 --
sets the re-review rule.

## Does the Claude Code team's own practice change this? (resolved: four additions; approval policy is the owner's)

"How the Claude Code team does code review" (Osmani, Lunt, Wang;
read 2026-10-23) describes a REVIEW.md written by code owners and
measured for whether the reviewer follows it. Compared item by item:

| Their practice                                                             | Here                                                                                             |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| REVIEW.md is short and says what failure looks like in the repo            | Added: the opening line; 189 lines to 170 while adding three sections                            |
| Summary starts with a count, says plainly when nothing to fix              | Added: "The summary"                                                                             |
| Cap nits; skip paths; `file:line` evidence, not a guess from a name        | Already in the first version                                                                     |
| Converge: round cap, diff-only re-review, flag the class, no repeats       | Added: "Re-reviews must converge". 59% of their re-flags were old code; ours ran 10 to 28 rounds |
| Verify before a PR exists; fresh-context review; fix repeats at the source | Already: `/code-review` in the lane map, `session-review` ledger                                 |
| An approval covers one commit                                              | Already: `steward` 4b pins the reviewed SHA                                                      |
| Every thread answered; open findings block merge                           | Answered by convention; blocking needs branch protection (owner)                                 |
| Risk tiers set from the change; CI workflows always need a person          | Not here: `steward` 4b lets the agent merge any tier (owner)                                     |
| Incidents and reverts become the reviewer's eval set                       | Not yet: barwise-nm8                                                                             |
| Measure noise by what people do with each comment                          | Partly: `pr-review` section 4 records outcomes on the thread                                     |

The rows marked owner are approval policy, which this repository
delegates by the owner's decision (`steward`, section 4b), so this spec
names them and does not change them.

## Alternatives considered

- **Put the new rules in `checklist.md` and keep REVIEW.md to service
  calibration.** One owner for all review rules. Lost because the
  service may not open a file outside the diff, so the rules most worth
  catching would reach it only if it chose to; and the user asked for the
  failure-derived rules to live in REVIEW.md. The checklist points at
  REVIEW.md instead, so there is still one owner per rule.
- **`@`-include split files at the root.** Keeps REVIEW.md short, but
  includes resolve only beside the root file and only from a protected
  branch, and they add root clutter for a file under 200 lines.
- **Restate the checklist in REVIEW.md.** Rejected: two owners of 60
  items, the drift `pr-creation` names as the most common Copilot finding.

## Risks and testing

- REVIEW.md cites paths; `check:instruction-refs` now scans it, with a
  sandbox case showing a dead path in a nested REVIEW.md fails, and
  `mutate.mjs` showing that case red when `REVIEW` is dropped from the
  pattern.
- The rules are prose; their test is whether reviews that apply them
  find more and are rebutted less. The `session-review` ledger and WS6
  of `tiered-pr-review.spec.md` are where that is recorded. A rule a
  reviewer cannot apply, or that produces rebutted findings, is edited or
  removed, not kept for completeness.
- Severity calibration takes effect on the service only once `main` is
  protected; until then REVIEW.md still adds rules, it just cannot lower
  severity or exclude paths.

## Non-goals

- No new CI gate for the failure modes. Each is a judgment a reader
  makes; where one becomes mechanical, it moves to a gate and leaves
  REVIEW.md.
- No change to who decides a merge (`steward`, section 4b).
