# Plan before code

Scope: process
Date: 2026-10-25
Tracking: barwise-ubc, docs/specs/plan-scope-check.spec.md,
docs/specs/touches-required.spec.md
Enforced-by: npm run check:plan-review (plan-reviewed),
npm run check:spec-touches (touches-named), none (barwise-ym8.yg7: spec-first),
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

1. **A change starts from a spec.**{#spec-first} Development begins with a spec in
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
4. **Open decisions are the reviewer's to settle.**{#open-decisions-reviewer} A spec states each
   one with its options, the trade-off and a recommended default, and
   does not decide it silently (`template.spec.md`, Open decisions).

## Consequences

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
- Decisions 1 and 4 have no gate. They are held by review: the
  `spec-writer` design gate and `pr-review`.
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
