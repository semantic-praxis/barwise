---
name: pr-creation
description: Use when opening a pull request on barwise, writing or revising a PR title and body, or deciding whether a branch is ready to ship - from a branch that is ready to push through to a PR that is open, watched, and handed to the steward. Speaks for the author - transmits the model they hold of the change (why, which files carry the decision, what order to read, what was verified and how, where they are least sure) so the reviewer judges instead of reconstructs. The conventions themselves live in CLAUDE.md, the PR template, and the skills this file points at.
---

# Opening a barwise PR

Scope note: this file speaks for the author; the `pr-review` skill
speaks for the reader, and the two are designed against each other.
Everything a reviewer would otherwise go hunting for -- intent, the
files that matter, test evidence, a risk read -- is cheaper to produce
here, once, by the one person who already holds it, than to rebuild
N times by people who do not. So `pr-review/checklist.md` is this
skill's output specification: what the reviewer will verify is what
this PR says up front. Where this file names a rule another file owns,
the cited file is the authority (spec: `docs/specs/pr-skills.spec.md`).

Two constraints hold throughout. **Never fabricate intent.** When a
change was produced without a reason anyone formed -- agent-authored
fallout, a mechanical sweep -- say so plainly; an invented rationale is
worse than silence because a reviewer will believe it. **Author cost
must not rise.** Everything below is derived from the branch, the
spec, and the tracker, in the order the commands appear; nothing asks
a human to fill in a form.

## 1. The readiness gate

CI checks what it can. These are the things it cannot, each missed at
least once:

- **The spec exists and its header says what this PR ships.**
  Spec-before-code is the convention (`spec-writer` skill). A PR is
  one workstream of a spec and names which. Update the spec's
  `Status` in the commit that lands the workstream: `audit:specs
  --check` catches only a spec claiming _no_ implementation, so a
  partial claim decays unwatched (barwise-912). Record what the spec
  did not anticipate in its implementation notes.
- **The tracking issue exists and this PR does not close it.** File
  it with `node scripts/beads-crud.mjs create` if missing. Closure is
  a tracker-only follow-up after merge (`steward`, section 5); the
  body says so. Follow-ups found on the way become issues, never
  TODO comments.
- **The branch sits on current `main`.** `git fetch origin main`
  first. A session once worked for hours on a local `main` 226
  commits stale and found out by accident (PR #406); the SessionStart
  hook builds but does not report freshness.
- **`npm run ci:local` is green from `barwise/`.** The pre-push hook
  runs it anyway; `--no-verify` is for work in progress, and work in
  progress does not get a PR. Build before any per-package `tsc
  --noEmit` (root `CLAUDE.md`, the stale-`dist` trap).
- **`pr-review/checklist.md` has been run against your own diff**, as
  a reviewer would run it, and what it found is fixed rather than
  promised.
- **The commits are the record.** Subjects prefixed as the log does
  (`feat:`, `fix:`, `docs:`, `chore:`), one concern per commit, no
  merge markers, no model identifiers in any commit or PR text.

## 2. Cut the diff for reading, not only for correctness

A change is normally cut so that it works. It also has to be cut so
that it can be understood in one uninterrupted sitting, which is a
different constraint and sometimes a stricter one. The unit here is a
spec workstream, and barwise has no stacking tool, so the cut is made
at two grains: separate PRs when each is green on its own, otherwise
separate commits inside one PR with the reading guide (section 4)
saying "read by commit".

- **Mechanical apart from semantic, by default.** A rename across
  forty files reviews at a glance alone and poisons a diff when mixed
  with logic. This is the highest-value cut available; make it before
  anything else.
- **Additive before destructive.** Add the new path in one commit or
  PR, remove the old in another. A deletion riding behind an addition
  gets less scrutiny than it deserves. The destructive commit says,
  for each guard or check it removes, where that invariant now lives;
  a reviewer audits every deleted line for exactly this, and the
  answer is free to the author.
- **Orientation across workstreams.** Each PR in a spec's sequence
  states what the workstreams below it established and what the ones
  above depend on. Two lines, and they remove the cost that
  reviewing in isolation imposes on understanding.
- **Do not manufacture structure.** A tight single-concern change
  stays one PR. A forced split is overhead in the costume of rigour.

The rule for when to cut, so it is not left to mood: a spine of more
than five files, or fallout that needs more than one pattern to
describe, or a reading guide whose spine takes more than about ten
minutes to read, is the signal to look for a seam. Below all three,
do not cut.

## 3. The title states the outcome

A title is a sentence about what is now true, not a label for the
diff. `Move the Python project to barwise/ so uv can actually find it`
lets a reader decide relevance without opening the PR; `Update
pyproject location` does not. The `articulation` skill's
commit-message rule applies: lede first, no ambiguous reference, no
missing bridge.

## 4. The body transmits the author's model

The PR template fixes only its last section. Derive the rest from the
branch -- `git log --reverse origin/main..HEAD`, `git diff --stat
origin/main...HEAD`, the spec, the issue -- and write it in this order.
Every section is a claim the reviewer will check; make each one
checkable.

1. **What and why, in one paragraph.** Spec and workstream, the
   one-sentence resolution (the `articulation` verbalization test: an
   "and" means two PRs), the issue whose closure follows, and what the
   spec asked for against what was delivered. Anything beyond the ask
   is named here, not discovered in the diff.
2. **Reading guide.** Most PRs are a tenth _spine_ -- the few files
   where the decision lives -- and nine tenths _fallout_: a rename
   propagating, tests trailing a type, generated output. Only the
   author can tell them apart for free. Name the spine as an ordered
   list with one line on why each file comes before the next; describe
   the fallout by pattern, not by file ("these twenty-six propagate
   the rename: verify the pattern, not the instances"); and mark where
   a reviewer with ten minutes should stop. Say which ordering you
   chose -- dependency order reads best for comprehension, narrative
   order starts from what motivated the change, risk order front-loads
   consequence so an interrupted review still saw what mattered -- and
   mark the risk peak separately rather than pretending one order
   serves both.
3. **Evidence, measured.** "Tested" is an assertion; the output of the
   test is evidence, and only one survives a skeptical reader. Every
   number carries the command that produced it and a before/after
   where there is one. A figure inferred from a package total reached
   a merged body and was only re-derived a PR later (PR #407, "eight
   tests skip"). A code block or a short table, not a sentence.
4. **Decisions and rejected alternatives.** Which of the spec's open
   decisions you took as recommended, which stay open, what you tried
   and dropped, and anything you decided that was the reviewer's call
   -- say so rather than let it pass as settled. Merging a spec does
   not answer its open questions.
5. **Where you are least sure.** The part of the diff you would want a
   second pair of eyes on, and why. A body that reads as certain about
   its shakiest part misdirects review, which is worse than saying
   nothing. If the honest answer is "this part was generated and no
   reason was formed," write that.
6. **The behaviour change, stated rather than buried.** If a user, a
   shipped bundle, or CI sees something different afterwards, one
   section says exactly what, including when the answer is "less"
   (a tier degrading, a check that now fails where it skipped).
7. **What the spec did not anticipate.** Deviations, mechanisms that
   turned out not to exist, predicted work that was unnecessary. The
   same notes go in the spec; the body points at them.
8. **Session review.** The template's last section, always present,
   produced by the `session-review` skill -- run its step 0 (read the
   process ledger) before writing a word. "Nothing this session" is
   legitimate, and false in any session where a human corrected you.
9. **The attribution footer** the harness requires.

The skeleton, so nothing above is left without a slot:

```
<what and why, one paragraph: spec + workstream, resolution, issue,
 ask vs delivered>

## Reading guide
<ordering chosen and why>
1. <spine file> -- <why it comes first>
2. <spine file> -- <why next>
Fallout: <pattern>: <what to verify instead of reading each file>.
Ten minutes: stop after <n>. Risk peak: <file or section>.

## Evidence, measured
<command -> result, before/after where there is one>

## Decisions
<taken as recommended / still open / decided that was the reviewer's call>

## Where I am least sure
<the part and why, or "generated; no reason was formed">

## Behaviour change
<what a user, bundle, or CI sees differently, or "none">

## What the spec did not anticipate
<deviations, also recorded in the spec>

## Session review
<per the session-review skill>
```

Leave out the session narrative, a restatement of the diff, and praise
for the change. The diff records what changed; the body records what
it claims and how that was checked.

Write the body to a file and pass the file. A body built inline in a
shell command lost its backticks once (PR #409's session review): the
shell ran them as commands and the tool reported success.

## 5. Opening it

- Base `main`, ready for review, never a draft: a PR that is not
  ready is a branch. Remote sessions use the GitHub MCP tools;
  locally, `gh auth switch --user gabeschenz` first (`AGENTS.md`).
- Subscribe to the PR's activity, then read the `steward` skill: from
  here the PR is being driven, and that file owns the mechanics
  (tracker conflicts, regenerators, the ratchet, the pre-push order).
- Nothing is done until `git status` shows the branch up to date with
  origin (root `CLAUDE.md`, Session Completion).

## 6. While it is open

The body is a contract, so a push that changes what it claims changes
the body too: a new number, a reversed decision, a deviation a
reviewer found. A reviewer reading a stale body verifies the wrong
thing, and the reading guide is the first section to go stale when
files are added.
