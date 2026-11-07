# Plan before code

Scope: process
Date: 2026-10-25
Tracking: barwise-ubc, docs/specs/plan-scope-check.spec.md,
docs/specs/touches-required.spec.md
Enforced-by: npm run check:plan-review (plan-reviewed),
npm run check:spec-touches (touches-named),
npm run check:spec-form (open-decisions-reviewer), none (barwise-ym8.yg7: spec-first),
none (barwise-ym8.ogi: plan-reviewed), none (barwise-ym8.8hq: touches-named),
none (barwise-ym8.l7d: open-decisions-reviewer)

## Context

Before this rule was enforced, 90 of 120 spec-adding PRs since
2026-07-01 shipped code in the same PR, so a spec was reviewed, if at
all, beside the code it was meant to shape, and a reviewer had to
reconstruct which files the change intended to touch. The rule was a
convention in the root `CLAUDE.md` and in the `spec-writer` skill,
and nothing checked it. The reasoning, the measurements and the
rejected alternatives are in the two specs above.

## Decision

1. **A pull request that changes package source names the spec it
   implements, in its body or a commit message, or carries a `No spec:
   <reason>` line.**{#spec-first} A check reads the presence and form of
   one or the other, never the reason. The spec lives in
   `barwise/docs/specs/`, written to the `spec-writer` skill's format.
2. **The plan is reviewed before it is implemented.**{#plan-reviewed} `/code-review`
   and `/pr-review` run on the spec, and its header records the commit
   they read as `Plan-reviewed: <commit> (code-review, pr-review)`,
   committed before any implementation commit. The line vouches for the
   spec's body as it stood at that commit; a plan edited afterwards
   needs the review again.
3. **A plan names what it will touch.**{#touches-named} A spec's `Touches:` header
   lists the paths it changes: unmarked for files that must be tracked,
   `+` for files it creates, `-` for files it deletes. A new spec must
   carry at least one unmarked or `-` entry that resolves to a path
   outside `barwise/docs/specs/`; `+` entries alone do not count.
4. **Every spec has an Open decisions section, and each entry gives its
   options, the trade-off and a recommended default.**{#open-decisions-reviewer}
   The reviewer settles them; a spec does not decide one silently
   (`template.spec.md`, Open decisions).

## Consequences

- Decisions 1 and 4 were restated on 2026-11-06 (`adr-refactor.spec.md`,
  rows 14 and 15) to what a check can read. Decision 1 was "a change
  starts from a spec"; its `No spec:` escape makes the exception
  explicit, which the owner chose over strict enforcement and over
  retirement. Its check is batch 10 of that spec, beside
  `check:plan-review`; until it lands, the gap issue in the header
  stands.

- `npm run check:plan-review` (a CI gate on pull requests to main) fails a
  PR that changes a `Touches:` path of a spec it names, while the spec is
  new or claims nothing is built, unless the `Plan-reviewed:` commit
  precedes every implementing commit and its body matches the plan as
  implementation began.
- `npm run check:spec-touches` (a CI gate on every event) fails a new
  spec unless its `Touches:` has an unmarked or `-` entry that resolves
  to a path outside `barwise/docs/specs/`; `+` entries alone never
  count. A spec is new when its file name was absent at the fixed
  cutoff commit, so a spec that lands by any route is checked.
- `npm run plan-scope` reports a branch's files outside its named plan
  and its size among recent PRs. It never fails, and it runs only when
  an author or reviewer runs it (`pr-creation`, `pr-review`): size and
  "outside the plan" are shadows of review cost, and a gate on them
  would be gamed.
- `npm run check:spec-form` (a CI gate on every event, no `if:` guard)
  fails a spec new since a fixed cutoff commit unless it has an
  `## Open decisions` heading and each top-level entry says one of
  "recommend", "resolved", "taken as", "decided" or "default"; a section
  that says only `None.` is accepted, since the template tells an author
  to drop sections that do not apply. A spec is new by the same file-name
  rule as `check:spec-touches`, against its own constant
  (`OPEN_DECISIONS_REQUIRED_SINCE`). Specs present at the cutoff are
  exempt (owner, 2026-11-07), not conforming: 75 of 201 lacked the
  heading, and sweeping them is barwise-1007's. The gate holds the section
  and the default. The options and the trade-off are not machine-readable,
  and a decision made silently in a spec's body is held by review (the
  `spec-writer` design gate and `pr-review`); barwise-ym8.l7d stays open
  for that residue.
- Decision 1 has no gate yet; it is held by review until the gap issue in
  the header lands one.
- Gaps in what enforces decision 2, each open:
  - a spec whose Status claims some work is built is not checked, so
    its second workstream onward is unreviewed by the gate, and the
    gate fires only where the diff overlaps the declared `Touches:`
    (barwise-x3l);
  - the `Plan-reviewed:` line is read at HEAD, so it can be added after
    the implementation; the review names in it are not checked; and
    plan edits made after implementation begins are never compared
    (barwise-wzl);
  - the gate runs only on pull requests to main, and holds only while
    PRs merge with a merge commit: a squash or a rebase after review
    loses the named commit (barwise-z4h).
- Gaps that are deliberate:
  - specs that existed at the cutoff without `Touches:` are outside
    `check:plan-review` (owner, 2026-10-24: existing specs exempt);
  - a code change that names no spec is not refused
    (`plan-scope-check.spec.md`, "Should the check fail a build?");
  - the gate ties the review claim to a named commit and body; it cannot
    show that the reviews were done well.
- `npm run audit:specs -- --check` can answer differently on a branch
  head than on its merge ref when the branch has merged main
  (barwise-dm0).
- Specs in progress are edited as their workstreams land, and the gate
  does not see those edits once Status claims work built (barwise-x3l):
  `architecture-index.spec.md` was edited this way by the first two
  ADR PRs, and its `Plan-reviewed:` line was re-pointed to the head
  their reviews read.
