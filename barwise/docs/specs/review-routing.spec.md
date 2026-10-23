# Review routing: start every review from the list of what applies to the diff

Status: Draft -- no workstream implemented

Created: 2026-10-23
Last-updated: 2026-10-23
Tracking: barwise-6mf
Touches: barwise/scripts/pr-risk.mjs, barwise/scripts/lib/review-tiers.mjs,
barwise/review-tiers.json, barwise/scripts/check-review-tiers.mjs,
barwise/scripts/tests/gates.test.mjs, .github/workflows/ci.yml,
.claude/skills/pr-review/SKILL.md, .claude/skills/pr-creation/SKILL.md

In one sentence: `pr-risk` already computes which `pr-review` checklist
groups a diff triggers, and nobody reads it; this spec puts its output
at the start of every review, adds REVIEW.md's failure modes to what it
routes, and keeps the triggers paths cannot see on the page every time.

Depends on PR #712 for WS2: REVIEW.md and its "Always check" list exist
only on that branch until it merges.

## Principle

Explicit over implicit, and define errors out of existence. A reviewer
today reads `.claude/skills/pr-review/checklist.md` and decides by hand
which of its thirteen groups apply ("Say which groups applied",
`pr-review` section 3). That decision is the one the reviewer is least
placed to make well: a group skipped because nobody noticed the diff
touched a script reads exactly like a group skipped because it did not
apply. barwise-i61 recorded the "Every PR" group skipped three times in
one day.

The machine half of that decision is already built. `pr-risk.mjs`
(`tiered-pr-review.spec.md`, WS3) classifies a diff against
`barwise/review-tiers.json`, prints every checklist heading the diff
triggers with the files that triggered it, and lists the groups no path
can detect. Its only consumer is `copilot-review.yml`, which reads the
`trivial` flag and is paused. The routing exists, is gated for drift
(`check:review-tiers`), and reaches no reviewer.

## Is the routing worth reading? (resolved: yes, and the measurement says where)

Measured over the last 40 pull-request merges on `origin/main` at
`1a32f9c7` (2026-10-08 to 2026-10-23), with the WS3 method of
`tiered-pr-review.spec.md` (`Merge pull request #N` merges only, three-dot
diff, `--name-status --no-renames`, then `npm run pr:risk -- --files -
--json`):

| Measure                                                       | Value    |
| ------------------------------------------------------------- | -------- |
| Path-derived checklist groups per PR, beyond "Every PR"       | median 3 |
| PRs that trigger none                                         | 12 of 40 |
| Most frequent: "When a spec was added or revised"             | 27 of 40 |
| "When tests changed"                                          | 21 of 40 |
| "When a check, gate, hook, or script was added or changed"    | 12 of 40 |
| "When a skill, agent brief, CLAUDE.md ... changed"            | 11 of 40 |
| "When a surface changed (CLI, MCP, VS Code)"                  | 8 of 40  |
| "When `@barwise/core` changed"                                | 4 of 40  |
| Groups no path can detect, which apply to every PR regardless | 3 of 13  |

A median of three groups out of thirteen is the value of the routing: a
reviewer reads three sections with named files instead of scanning
thirteen and guessing. The three groups paths cannot see (types chosen,
interfaces widened, copies added) stay on the page every time, as
`pr-risk` already prints them.

The same 40 PRs measured against candidate paths for REVIEW.md's failure
modes: importer, exporter and serializer directories fired on 7, SQL and
DDL directories on 4, `core/src/model/` on 3, and the bundle entries and
tool registrations on 3. Those are selective triggers, which is what
makes them worth adding. The measurement scripts are not committed;
WS2's acceptance criterion re-runs the measurement through `pr-risk`
itself.

## Scope

In scope:

- When `npm run pr:risk` classifies a diff, the system shall print the
  checklist groups and the REVIEW.md failure modes the diff triggers,
  each with the files that triggered it.
- When a checklist group or failure mode has no path trigger, the system
  shall print it on every run under its own heading, and shall never
  omit it.
- When `pr-risk` prints REVIEW.md's failure modes, it shall print every
  one of them, path-triggered ones first, because REVIEW.md tells every
  reviewer to run all of them.
- When REVIEW.md's "Always check" items and the table's failure-mode
  rows disagree in either direction, `check:review-tiers` shall exit 1
  and name the disagreement.
- When REVIEW.md cannot be read or its "Always check" list has no items,
  `check:review-tiers` shall exit 2.
- When `pr-review` reviews a head, the reviewer shall start from
  `pr-risk`'s output for that head and say in the review which listed
  groups and failure modes ran.
- The routing shall never change `pr-risk`'s exit status: 0 when it
  classified, 2 when it could not read the diff.

Out of scope:

- The tier itself, and whether 55% high-risk means the globs are wrong.
  That is `tiered-pr-review.spec.md` WS3's open finding, unchanged here.
- An LLM classifier for the triggers paths cannot see. The Claude Code
  team uses one (a second classifier that asks whether a change needs a
  person despite its tier); it is non-deterministic and belongs outside
  `barwise/scripts/`. Named under Alternatives.
- Any gate on the routing. It reports.

## Inventory

| Module                                   | Current state                                           | Verdict                                                    |
| ---------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| `barwise/scripts/pr-risk.mjs`            | Classifies; prints tier, matched headings, beyond-reach | Gains failure modes in its output (WS2); text layout (WS1) |
| `barwise/scripts/lib/review-tiers.mjs`   | One parser for the table and the checklist headings     | Gains the REVIEW.md "Always check" parser (WS2)            |
| `barwise/review-tiers.json`              | 13 rows keyed to checklist headings, plus `trivial`     | Gains a `failureModes` block (WS2)                         |
| `barwise/scripts/check-review-tiers.mjs` | Bidirectional heading check, exit 0/1/2                 | Also compares failure-mode titles both ways (WS2)          |
| `.claude/skills/pr-review/SKILL.md`      | "Say which groups applied", decided by hand             | Starts from `pr-risk` output (WS1)                         |
| `.claude/skills/pr-creation/SKILL.md`    | Author runs the checklist against own diff              | Same instruction, author side (WS1)                        |
| `gates.test.mjs`                         | Covers `pr-risk` and `check-review-tiers` branches      | New cases for each WS2 branch, seen red first              |
| `ci.yml`                                 | Runs `check:review-tiers`                               | Possibly prints routing (WS3, provisional)                 |

`copilot-review.yml` reads only `.tier` and `.trivial` from the JSON, so
adding fields to it does not change the workflow's behaviour.

## Target architecture

```
REVIEW.md "Always check"  --- titles --->  review-tiers.json
checklist.md "## " headings --- names -->    rows[]          (exists)
                                             failureModes[]  (WS2)
                                                  |
                     lib/review-tiers.mjs (one parser for all three)
                         |                               |
          check-review-tiers.mjs                   pr-risk.mjs
          both directions, exit 0/1/2              routing report, exit 0/2
                                                         |
                                     pr-review / pr-creation start here
```

A failure-mode row has the same shape as a checklist row -- `heading`,
`tier`, `globs`, `why` -- with `heading` holding the REVIEW.md title, so
one row validator serves both arrays:

```json
{
  "heading": "Input dropped at a boundary",
  "tier": "high-risk",
  "globs": [
    "barwise/packages/formats/src/",
    "barwise/packages/dbt/src/",
    "..."
  ],
  "why": "importers, exporters, loaders and serializers: 7 of the last 40 PRs"
}
```

`tier` takes the table's existing values: `always` with `globs: ["**"]`
(failure mode 8, PR description claims), `not-path-derivable` with no
globs (failure mode 5, restated facts, which can live in any file), and
`high-risk` or `routine` for a path-routed mode, by the same test the
checklist rows use. WS2 extracts the per-row validation inside `tierRows`
into one function that both the `rows` and `failureModes` arrays call,
so there is no second validator and no new matcher; globs use the
existing four-shape pattern language through `patternFault`.

The REVIEW.md parser reads the numbered items under the first `##`
heading that starts with `Always check`, so the heading's date range
(`## Always check: the failure modes of 2026-09-23 to 2026-10-23` on
#712's branch) can change without breaking it. It takes each item's bold
lead (`1. **Input dropped at a boundary.**`) as its title, with the
trailing period REVIEW.md writes stripped, so the row reads
`Input dropped at a boundary`. It throws on a
missing heading or zero items,
as `checklistHeadings` does, so the gate refuses rather than reporting
eight stale rows from a file it never opened.

## Alternatives considered

- **Write the triggers inside REVIEW.md, beside each failure mode.** One
  file, no copy, nothing to keep in step. It lost on two counts: the
  Claude Code Review service reads REVIEW.md as instructions, and path
  lists there are noise to it; and a glob list parsed out of prose is a
  second pattern-language host the validator would have to find. The
  table is already the registered, gated copy of the checklist's
  headings, and adding REVIEW.md's titles to it follows that precedent.
- **A new `review-route.mjs` beside `pr-risk.mjs`.** Cleaner name, and
  `pr-risk` is a risk classifier by origin. It lost because both would
  take the same three inputs (`--changes`, `--files`, `--base`) with the
  same refusal rules, and those took several Copilot findings on #533
  (named in `pr-risk.mjs`'s comments) to get right in one place. A second reader of the same input is the copy the
  CLAUDE.md rule forbids. Renaming the npm script is an open decision.
- **An LLM classifier over the diff.** It could route the three groups
  paths cannot see (types chosen, interfaces widened, copies added),
  which is where most review judgment lives. It is non-deterministic,
  needs a key in CI, and its misses look like clean runs. It stays a
  candidate for a later spec once there is a way to score it (barwise-nm8,
  filed with #712, proposes an eval set of the month's real defects).

## Workstreams (each independently shippable)

### 1. Put the existing output in front of reviewers

No new data. Change `pr-review` section 3 from "Say which groups
applied" to "Run `npm run pr:risk -- --base origin/main` on the head;
the groups it lists, and every group it lists as not path-derivable, are
the ones you run; say which ran." Add the same line to `pr-creation`'s
readiness list for the author's own pass. Reorder `pr-risk`'s text
output to lead with the groups to run and their files, with the tier
line after them, since a reviewer reads the list and the workflow reads
the JSON.

Acceptance: a `pr-review` run on any open PR quotes the routing in its
Read line; `gates.test.mjs` cases for `pr-risk`'s text output are
updated and still pass.

### 2. Route REVIEW.md's failure modes (after #712 merges)

Add `failureModes` to `review-tiers.json`, the REVIEW.md parser to
`lib/review-tiers.mjs`, the both-ways comparison to
`check-review-tiers.mjs`, and the routed failure modes to `pr-risk`'s
text and JSON output. Each new branch gets a sandbox test seen red via
`mutate.mjs`: a title in REVIEW.md with no row, a row with no title,
REVIEW.md missing, an empty "Always check" list.

Routing orders the failure modes; it never removes one. REVIEW.md says
to run all eight on every PR, and the service reads that instruction
directly, so `pr-risk` prints every failure mode: the path-triggered ones
first with the paths that triggered them, then the rest under "not
triggered by path -- still run". A skill or reviewer that reads only the
first group is reading the report wrong, and the heading says so.

Acceptance: re-running the measurement above through `pr-risk` reports
the per-failure-mode counts; any failure mode that fires on more than
half of the last 40 PRs has its globs narrowed or is moved to `always`,
because a trigger that always fires routes nothing.

### 3. Print the routing in CI (provisional: not yet grounded)

An informational CI step that runs `pr-risk` on the PR and prints the
routing to the job log, never failing. It would make the list visible to
a human reviewer who does not run the skill. Not grounded: CI's checkout
depth and whether `origin/main` resolves there are unverified, and
`pr-risk` refuses (exit 2) on a shallow clone by design.

## API and migration impact

- `pr-risk --json` gains `failureModes` and `failureModesBeyondReach`;
  existing fields are unchanged.
- `review-tiers.json` gains a block. `tierRows` reads only `rows` and
  `trivialGlobs` only `trivial`, so existing readers ignore it.
- No package code changes. Everything is under `barwise/scripts/` and
  `.claude/skills/`.

## Open decisions (for review)

- **Where the routing is shown.** Skill-invoked only (WS1); also the CI
  log (WS3); or also a PR comment. Recommended: WS1 now, WS3 if WS1
  shows reviewers using it. A PR comment on every push is the noise the
  Claude Code team's post warns about.
- **One table or two.** Failure modes in `review-tiers.json` beside the
  checklist rows, or a new `review-routing.json`. Recommended: one table,
  one parser, one gate.
- **Rename `pr:risk`.** Its job becomes routing first and tiering second.
  Recommended: keep the name until WS2 lands, then decide; a rename
  touches `copilot-review.yml` and the tiered-review spec.
- **Failure mode 4 ("wired in one place").** Its entry-point half is
  path-shaped and its "new export with no caller" half is not.
  Recommended: route it by the entry-point paths and say in its `why`
  that the export half is read regardless.

## Risks and testing

- A failure mode routed by path could read as "does not apply" whenever
  the path list misses where the defect lives. That is why routing orders
  rather than filters (WS2), why the beyond-reach list exists, and why the
  `why` field records what each glob list was measured against so a later
  reader can re-measure.
- REVIEW.md wording edits break the title match and fail
  `check:review-tiers`. That is the gate working, and the failure message
  must name the title on both sides so the fix is one edit.
- `pr-risk` and `check-review-tiers` are tested in `gates.test.mjs` with
  sandboxed inputs; WS2 adds a case per new branch, each seen failing
  before passing.

## Non-goals

- No change to the tier rules or the `trivial` allow-list.
- No blocking: routing never fails a build or a review.
- No LLM in `barwise/scripts/`.
