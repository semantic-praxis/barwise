# PR creation and PR review skills: the author's side and the reader's side of a barwise PR

Status: Implemented (both skills and the shared checklist land alongside this spec)
Created: 2026-09-05
Last-updated: 2026-09-05
Tracking: barwise-922

## Principle

Explicit over implicit, and orthogonality. A barwise PR already has
conventions on both sides -- what its body must say (the template, the
`session-review` skill), what happens after it opens (`steward`), what
precedes it (`spec-writer`) -- but nothing owns the two moments that
matter most: the author deciding the branch is ready and writing the
body, and a reader deciding what the PR is worth and where its risk
is. Each session re-derives both from CLAUDE.md, the git log, and the
last PR it can find, which is how a PR shipped with an inferred number
(PR #407) and how reviews start from the diff instead of the claim.

The two moments are halves of one system and are designed against
each other: every input a reviewer goes hunting for -- intent, the
files that carry the decision, test evidence, a risk read -- is free
to the author at submission time and expensive for everyone after.
Work paid once at creation, by the one person holding the context,
beats the same work paid N times at review by people who do not. The
reader's checklist is therefore the author's output specification.

DRY-secondary bounds the design as it bounded `steward`: the skills
carry only what no other file owns and point at the authorities for
the rest. A rule stated in two places drifts, so the list of invariants
CI cannot check has exactly one home.

## Should the checklist have one owner? (resolved: yes, the reviewer)

Both skills need the same list of judgment items, which makes it a
must-agree copy the moment it is written twice. It lives in
`pr-review/checklist.md` because the reader is the audience whose
action depends on it: a reviewer runs it, and an author runs it as a
reviewer would. `pr-creation` names the file as its output
specification and does not restate a line of it. The checklist in turn
excludes by construction anything `npm run ci:local` runs, so it cannot
drift from `ci.yml` on the items CI owns.

## Scope

In scope, in EARS form:

- When a session prepares to open a PR, the `pr-creation` skill shall
  give it the readiness gate CI cannot run, the cut that separates
  mechanical from semantic change, the house title rule, and the body
  order that transmits the author's model (reading guide with spine,
  fallout by pattern, a stop marker and a named ordering; measured
  evidence; decisions; least-certain part; behaviour change; spec
  deviations; session review).
- When a session reviews a PR, the `pr-review` skill shall give it the
  read order (body first, spec, CI, then diff by the guide), the claim
  verification rule (re-run every number; watch a new gate go red),
  the agent-authored failure-mode checks, the findings form, the
  five-part net-subtractive review shape with an explicit "not
  checked", and the posting rule (recommend, never approve or merge).
- When either skill needs an invariant CI does not check, it shall
  read it from `pr-review/checklist.md`, grouped by what the diff
  touches, each item carrying its authority.

Out of scope: any script, CI step, or hook (workstream 2 below is
provisional and filed, not built); posture rules the harness already
enforces (never skip a test, never rewrite another's history); the
`steward` skill's post-open mechanics; a `pr-stacking` or
`change-scoping` skill -- the north-star documents assume both exist
and barwise has neither, so the creation skill maps their intent onto
what barwise has (spec workstreams, and commits within one PR).

## Inventory

| Module                                  | Current state                                    | Verdict                                       |
| --------------------------------------- | ------------------------------------------------ | --------------------------------------------- |
| `.claude/skills/pr-creation/SKILL.md`   | Does not exist                                   | New: the author's side                        |
| `.claude/skills/pr-review/SKILL.md`     | Does not exist                                   | New: the reader's side                        |
| `.claude/skills/pr-review/checklist.md` | Does not exist                                   | New: single owner of the CI-blind invariants  |
| `.github/pull_request_template.md`      | Fixes only the Session review section            | Unchanged; `pr-creation` orders what precedes |
| `.claude/skills/session-review`         | Owns the last body section                       | Unchanged; pointed at                         |
| `.claude/skills/steward`                | Owns post-open mechanics                         | Unchanged; pointed at                         |
| `CLAUDE.md` (root)                      | Names `spec-writer`, `release`, `steward` skills | One pointer sentence added under Conventions  |
| `.github/workflows/ci.yml`              | Owns the gate list                               | Unchanged; the checklist excludes it by name  |

The built-in `/code-review`, `security-review`, `duplication-audit`,
`assertion-audit`, and `articulation` skills are composed, not
duplicated: `pr-review` names when each applies and carries only the
barwise-specific pass and the protocol.

## Target architecture

```
.claude/skills/pr-creation/SKILL.md      speaks for the author
  1 readiness gate (CI-blind items)      -> points at spec-writer, steward, CLAUDE.md
  2 cut for reading                      mechanical/semantic, additive/destructive,
                                         orientation across workstreams
  3 title states the outcome             -> articulation
  4 body transmits the model             what/why, reading guide, evidence,
                                         decisions, least-sure, behaviour change,
                                         spec deviations, session review, footer
  5 open it, subscribe                   -> steward
  6 keep the body current

.claude/skills/pr-review/SKILL.md        speaks for the reader
  1 read order                           body, spec+issue, CI, diff by guide
  2 verify claims                        re-run numbers; red before green;
                                         fallout as a default-deny test
  3 agent-authored failure modes         weakened tests, silenced ratchets,
                                         scope drift, absent intent,
                                         instructions-as-logic
  4 findings form                        suggestion blocks for mechanical fixes
  5 review shape                         recommendation / read / cleared /
                                         findings / not checked
  6 posting                              COMMENT or REQUEST_CHANGES, never APPROVE
  7 no test for this file                author acceptance is the signal

.claude/skills/pr-review/checklist.md    the one list, grouped by trigger,
                                         excluding everything ci:local runs
```

## Alternatives considered

- **One skill with two modes.** Shorter, but the two audiences act at
  different moments and a session loads a skill for one of them; a
  combined file makes each read carry the other half. Lost.
- **Checklist inlined in both skills.** The must-agree copy the repo
  has a rule against; nothing would check the two lists agreed. Lost.
- **Checklist derived from `ci.yml`.** Backwards: the checklist is
  exactly the set CI cannot express, so there is nothing to derive it
  from. It excludes `ci.yml`'s items by construction instead, which is
  the derivation that is available.
- **A mechanical PR-readiness script now.** Consistent with "the most
  durable landing removes the choice", but each candidate check
  (session-review section present, spec `Status` mentions the
  workstream, body numbers carry commands) is either already a
  template default or needs judgment. Deferred to workstream 2 until a
  session shows the prose rule failing.

## What the built-in `/code-review` skill contributed (and what it did not)

The harness ships a general code reviewer, and the review skill here
is deliberately not a mirror of it: its value is repo-specific. Four
of its rules were adopted because they sharpen precision, which is the
north star's binding constraint. A conventions finding must quote the
exact rule and the exact line, never a reading of a document's spirit.
Every deleted line is audited for the invariant it enforced and where
that invariant now lives, which is also why `pr-creation` asks the
destructive commit to say so up front. Verification has three states,
and a refutation must quote the line or guard that makes the candidate
impossible, because a wrong "cleared" is the same confident wrong
answer as a wrong finding. And a final pass holds the finished list
and looks only for what is missing, without padding. Not adopted: its
effort-level flag (depth here follows the risk read, not an argument)
and its recall bias at high effort (the north star trades coverage for
precision, since precision is what earns the right to be skipped). The
correctness angles themselves are composed by invoking it, not copied.

## Workstreams

### 1. Author both skills and the checklist

Docs-only; lands with this spec. Adds one pointer sentence to the root
`CLAUDE.md`.

### 2. Derive the reading guide from the branch (provisional: not yet grounded)

A script that classifies `git diff --stat origin/main...HEAD` into
spine candidates and fallout patterns by churn shape and commit
grouping, emitting the guide's skeleton so the author edits rather
than writes. Justified by the north star's "author cost must not
rise"; unjustified until a session shows the prose instruction
producing guides that miss files. Filed on barwise-922; not built.

## Open decisions (for review)

- **Default submission state for a review.** `pr-review` submits as
  COMMENT unless a finding is blocking, then REQUEST_CHANGES.
  Recommended as written; the alternative (always COMMENT, verdict in
  prose) keeps the PR's review state neutral but hides the
  recommendation from the merge UI.
- **Should the prose detector cover `.claude/skills/`?** Raised by
  the `steward` spec and still open; three more skill files make it
  more worth doing. Recommended default unchanged: extend the walk
  when a skill is found to have drifted.
- **North-star fidelity.** The two north-star documents that shaped
  these skills are not in the repo. Recommended: leave them out --
  the skills carry their decisions with reasons attached, which is
  the repo's convention for persistent knowledge -- and revisit if a
  later reader needs the argument rather than the rule.

## Risks and testing

- Docs-only: `npm run fmt:check` gates the spec; the skills sit
  outside dprint's tree and are hand-wrapped at 80 columns.
  `audit:duplication -- --check` confirms no new unclassified prose
  candidate; `audit:specs -- --check` accepts an implemented status.
- The risk is the one the design names: the review skill is prose with
  no test. Mitigated by the external signal (author acceptance,
  recorded in the process ledger) rather than more self-review.

## Non-goals

- No change to CI, hooks, scripts, or the PR template.
- No restatement of harness posture rules or of CLAUDE.md content.
- No general-purpose code reviewer; `/code-review` remains that.
