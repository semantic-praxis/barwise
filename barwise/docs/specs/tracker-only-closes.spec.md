# A pull request that closes a tracker issue changes nothing but the tracker

Status: Implemented -- workstream 1 (this PR)

Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-i61

## Principle

The steward skill (section 5) says the issues a PR resolves are closed
in a tracker-only follow-up after it merges, and the pr-review checklist
says a PR does not close its own tracking issue. The reason is that a
close in a code PR records work as shipped while it is still a branch.
The rule is written down twice and enforced nowhere. In one session it
was broken three times and caught each time by a reviewer bot after the
PR was open: #604 filed and closed its own issue, #613 had no spec, and
#615 tracked its spec with an issue the same diff closed (barwise-i61).
Two of those three are the same mechanical fact: the diff closed an
issue and changed something besides the tracker. A fact that mechanical
is a gate's job, not a reviewer's.

The owner chose this check from three candidates on 2026-10-08. A
spec-reference check and a PR-body checklist were not chosen.

## Scope

In scope:

- When a pull request's diff closes a beads issue (its line in
  `.beads/issues.jsonl` has `status` `closed` at the head and did not at
  the base, including an issue created already closed) and also changes
  any file outside `.beads/`, the gate shall exit 1 and name each issue
  closed and the first few non-tracker files changed.
- When the diff closes issues and changes only `.beads/`, or closes
  nothing, the gate shall exit 0.
- When the gate cannot determine the base or read the tracker at either
  end, it shall exit 2 and print no PASS
  (`docs/specs/gate-refusal-contract.spec.md`).

The base is `$BASE_SHA` when set, which `ci.yml` sets from the pull
request's base commit. Otherwise it is `git merge-base origin/main HEAD`,
the same local fallback `ci-local.mjs` uses. The comparison is committed
state only: a pre-push run checks what is being pushed.

Out of scope:

- **The spec-reference rule** (#613's miss). Not chosen.
- **Reopening, or other status changes.** Only a transition to `closed`
  is a claim that work shipped.

## Where it runs

`ci.yml` runs it as a step with `if: github.event_name == 'pull_request'`
and `env: BASE_SHA`, and with no docs-only guard: a Markdown change that
closes an issue is exactly what it exists to catch (#616 closed
barwise-a98 alongside a spec). On a push to `main` there is no pull
request, so there is nothing to check. `ci-local.mjs` does not
understand that condition and runs the step anyway, which is right
locally, where every push is headed for a pull request.

## Alternatives considered

- **Fail on any close in a non-tracker diff, except one listed in the
  commit message.** An escape hatch for exactly the case the rule
  exists to stop; the tracker-only follow-up costs one small PR.
- **Check only the issue named in a spec's `Tracking:` line.** Narrower,
  and it would have missed #604, whose issue no spec named.

## Workstreams

### 1. The gate and its CI step

`barwise/scripts/check-tracker-closes.mjs`, the `check:tracker-closes`
npm script and its root forwarder, the `ci.yml` step, and tests in
`barwise/scripts/tests/gates.test.mjs` that build a sandbox repository
and assert the behavior:

- a diff that closes an issue and edits a `.ts` file fails;
- a diff that closes an issue and adds a `.md` spec fails;
- a diff that files an issue already closed, beside a code change, fails;
- a tracker-only close passes;
- a code change that closes nothing passes;
- a missing base exits 2.

## Risks and testing

- The rule makes a combined "docs plus close" PR, which this session
  used twice (#615, #616), fail. That is intended: the convention is a
  tracker-only follow-up.
- A false failure after merging `main` into the branch. A close made on
  `main` after the base commit would appear in the diff as if the branch
  made it. The gate shares the detect step's base
  (`pull_request.base.sha`), so it shares that step's assumption that
  the base is current. WS1 verifies the assumption on a real pull
  request that merged `main`, and adds a sandbox test of a merge from a
  moved base, before relying on it.

## Non-goals

- No change to `beads-crud.mjs` or the tracker format.
