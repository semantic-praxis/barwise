# Plan before code

Scope: process
Date: 2026-10-25
Tracking: barwise-ubc, docs/specs/plan-scope-check.spec.md,
docs/specs/touches-required.spec.md

## Context

Before this rule was enforced, 90 of 120 spec-adding PRs since
2026-07-01 shipped code in the same PR, so a spec was reviewed, if at
all, beside the code it was meant to shape, and a reviewer had to
reconstruct which files the change intended to touch. The rule was a
convention in the root `CLAUDE.md` and in the `spec-writer` skill,
and nothing checked it. The reasoning, the measurements and the
rejected alternatives are in the two specs above.

## Decision

1. **A change starts from a spec.** Development begins with a spec in
   `barwise/docs/specs/`, written to the `spec-writer` skill's format.
2. **The plan is reviewed before it is implemented.** `/code-review`
   and `/pr-review` run on the spec, and its header records the commit
   they read as `Plan-reviewed: <commit> (code-review, pr-review)`,
   committed before any implementation commit. The line vouches for the
   spec's body as it stood at that commit; a plan edited afterwards
   needs the review again.
3. **A plan names what it will touch.** A spec's `Touches:` header
   lists the paths it changes: unmarked for files that must be tracked,
   `+` for files it creates, `-` for files it deletes. A new spec must
   carry at least one entry that resolves to a path outside
   `barwise/docs/specs/`.
4. **Open decisions are the reviewer's to settle.** A spec states each
   one with its options, the trade-off and a recommended default, and
   does not decide it silently (`template.spec.md`, Open decisions).

## Consequences

- `npm run check:plan-review` (a CI gate on pull requests) fails a PR
  that changes a `Touches:` path of a spec it names, while the spec is
  new or claims nothing is built, unless the `Plan-reviewed:` commit
  precedes every implementing commit and its body matches the plan as
  implementation began.
- `npm run check:spec-touches` (a CI gate on every event) fails a new
  spec whose `Touches:` names nothing outside `barwise/docs/specs/`. A
  spec is new when its file name was absent at the fixed cutoff commit,
  so a spec that lands by any route is checked.
- `npm run plan-scope` reports a branch's files outside its named plan
  and its size among recent PRs. It never fails: size and "outside the
  plan" are shadows of review cost, and a gate on them would be gamed.
- Known gaps, each deliberate:
  - specs that existed at the cutoff without `Touches:` are outside
    `check:plan-review` (owner, 2026-10-24: existing specs exempt);
  - a code change that names no spec is reported by `plan-scope`, not
    refused (`plan-scope-check.spec.md`, "Should the check fail a
    build?");
  - the check proves the reviews were recorded against the plan, not
    that they were done well;
  - a squash merge keeps the `Plan-reviewed:` commit on the PR branch,
    out of main's history, so the line cannot be rechecked after merge.
- `npm run audit:specs -- --check` can answer differently on a branch
  head than on its merge ref when the branch has merged main
  (barwise-dm0).
