---
name: pr-review
description: Use when reviewing a barwise pull request - your own diff before opening it, another session's PR, or one the user asks you to review. Speaks for the reader - locates the risk, settles what a machine can settle, verifies the body's claims, and hands the human a defensible recommendation with what was and was not checked. Recommends; never approves or merges. The barwise invariants CI cannot check live in checklist.md beside this file.
---

# Reviewing a barwise PR

Scope note: human attention is the scarce resource and agent effort is
not, so every output of a review has to remove more human reading than
it adds -- a test to apply per section, not a slogan. The whole
arrangement rests on a human being willing to skip what the review
cleared, and that trust is earned slowly through precision and lost by
one confident wrong answer: a review that says less and is never wrong
beats one that says more and is usually right. This file is not a
general code reviewer; its value is knowing this codebase's rules,
failure modes, and history well enough to be precise about them (spec:
`docs/specs/pr-skills.spec.md`).

It composes with rubrics that already exist rather than repeating
them. `/code-review` is the correctness engine: it reads every hunk
and the enclosing function (a bug on an unchanged line of a touched
function is in scope), audits every removed line for the invariant it
enforced and where that invariant now lives, traces callers and
callees across files, and hunts language pitfalls. Run it on the spine
at high effort and on the fallout at low; take its CONFIRMED findings
and treat its PLAUSIBLE ones under section 4's rule. `security-review`
applies when the diff touches subprocess, network, or file I/O;
`duplication-audit` when it adds a copy; `assertion-audit` when it
adds a test for a refusal or error; `articulation` in critique mode
for the body and any doc. What `npm run ci:local` checks is never a
finding here: CI will say it, and saying it twice costs a round trip.

## 1. Read in this order

1. **The body**, as a set of claims: the reading guide, the evidence,
   the decisions, the part the author is least sure of. With a reading
   guide, the review's job is to verify it. Without one, build the
   spine/fallout split yourself, report it at the top of the review,
   and note that the author's side (`pr-creation`) did not run: that
   cost has moved from the one person who had it free to you.
2. **The spec workstream and the tracking issue**: what was asked.
   This is where scope drift is measured from.
3. **CI on the head commit**, so nothing red is re-derived by hand.
4. **The diff**, in the guide's order, spine before fallout. Reading
   effort is proportional to risk, not to line count: a 900-line
   rename costs less attention than 40 lines on a contract with live
   consumers, and the depth of the pass follows the risk read, not a
   flag.

## 2. Verify claims; never infer them

- Check out the head. Re-run the command behind every number in the
  body. A figure without a command is a finding in itself.
- A new gate, check, hook, or test is verified only after you have
  watched it go red: plant the defect where the gate actually looks
  (staged or tracked, not merely on disk), read the exit status with
  nothing in between, and see red before green (`session-review`
  skill; `npm run test:scripts` is the worked example for root gates).
  Seen only passing means not verified, and the review says so.
- A fallout claim ("these twenty-six propagate the rename") is a
  default-deny test, stated as "nothing here can change behaviour",
  with the listed examples as illustration. Sample the instances and
  grep for the exception the pattern does not cover. Enumerated
  skip-lists leaked three times in the build-up to this skill, each
  through a case nobody had listed.
- For every line the diff deletes, name the invariant it enforced and
  find where the new code re-establishes it. A removed guard, a
  dropped error path, a narrowed validation, a deleted test that
  covered a real case: each is a finding unless the author's body
  already says where it went.

## 3. The failure modes of the code actually being written

Agent-authored changes fail in characteristic ways. These are
first-class checks, run on every PR, not incidental coverage:

- **Tests weakened until CI passes.** A `.skip` added, an assertion
  loosened to `toBeDefined`, a coverage threshold lowered in a vitest
  config, a golden or snapshot regenerated with no reason in the
  commit, a test that now pins a limitation as correct behaviour
  (`assertion-audit`).
- **Ratchets silenced.** A new row in `audit-baseline.json`,
  `rubric-baseline.json`, or `spec-status-baseline.json` marked
  accepted with no note that survives a reader; an entry removed from
  `parity.manifest.json`; a drift test deleted rather than made to
  pass.
- **Scope drift and volume.** Files the reading guide cannot account
  for; work beyond what the spec workstream or issue asked, arriving
  unnamed. The body's first paragraph is where it should have been
  declared (`pr-creation`, section 4).
- **Intent absent.** A change with no stated reason. Ask for one on
  the thread; never supply one for the author, because the next
  reader will believe it.
- **Instructions are logic.** A change to `.claude/`, `CLAUDE.md`,
  `AGENTS.md`, an agent brief, or a prompt artifact is a behaviour
  change and gets a code-level review: does the rule carry its
  reason, does it restate something another file owns, would it have
  fired on the case that prompted it.

Then run `checklist.md`: the barwise invariants CI cannot check,
grouped by what the diff touches. Say which groups applied.

Finish with one more pass over the diff holding the list of what you
have found, looking only for what is not on it. The first pass tends
to miss moved code that dropped a guard, setup without teardown in a
test, and a config default flipped. If nothing new turns up, say so;
do not pad.

## 4. Findings are ranked, verified, and actionable

Each finding names the file and line, what is wrong, the concrete
failure scenario (these inputs, this wrong outcome), the authority it
violates, and the fix. A conventions finding quotes the exact rule and
the exact line that breaks it, from the CLAUDE.md, spec, or skill that
owns the rule; a reading of the "spirit" of a document is not a
finding.

- A fix with one correct mechanical form arrives as a GitHub
  suggestion block the author accepts in a click -- only when the
  block fully fixes the issue -- or as a pushed commit on a PR you
  own (`steward`). Prose that someone must read, re-derive, and retype
  is the expensive form.
- A finding with genuine alternatives arrives with those alternatives
  and a recommendation, so the human agrees or redirects instead of
  starting from the problem.
- Three states, and each is earned. CONFIRMED means you reproduced it
  or can show the line. PLAUSIBLE means the mechanism is real and the
  trigger is a realistic runtime state (a cold cache, a missing
  optional field, a boundary the code does not exclude); report it
  labelled as such, ranked below confirmed, and only when being wrong
  is cheap for the reader -- otherwise it is a question on the thread.
  REFUTED needs the quoted line, type, or guard that makes the
  candidate impossible; "seems unlikely" refutes nothing, and a wrong
  refutation is the same confident wrong answer as a wrong finding.
- Correctness outranks cleanup. Nits last, labelled as nits. No
  praise, no restatement of the diff, nothing dprint or eslint
  polices.
- When a finding is later fixed, skipped, or found wrong, say which,
  on the thread that raised it. The record of outcomes is what shows
  whether this file's findings are worth acting on (section 7).

## 5. The shape of the review

Five parts, in this order, and nothing else:

```
Recommendation: merge / merge after <items> / do not merge -- <one sentence>.
Read: <spine, in order, with the minutes it costs>. Risk peak: <file>.
Cleared: <regions>, because <the test that clears each one>.
Findings: <ranked, per section 4>.
Not checked: <what, and why>.
```

State the asymmetry to yourself when filling in Cleared: a false
"read this" costs minutes, a false "cleared" costs the whole review.
When in doubt, it goes under Read. And a partial review that looks
complete is worse than none, because it is trusted on false pretences;
Not checked is never empty by omission, and it names which passes ran
(a single pass with no verification says so).

## 6. Posting, and who decides

- Your own diff before opening: fix it; no comment needed.
- The user asked for the review in conversation: deliver it there,
  and post to GitHub only if asked.
- Another PR: post as a review (a pending review, inline comments,
  then submit as COMMENT or REQUEST_CHANGES) with the attribution
  footer. Never APPROVE and never merge. The merge decision and its
  accountability stay with a person; a model cannot be paged and
  cannot answer for what it shipped.

Three verdicts are honest: ready (with what was verified), not ready
(with the blocking items), and cannot tell (with what could not be
reproduced and why). Never dress the third as the first.

## 7. This file has no test

Its logic is prose, so nothing checks it for self-consistency the way
a suite checks code, and self-review of it converges slowly. The
external signal is the one that counts: does the author accept what
the review proposed. When an author rejects a finding with a reason,
that is evidence about this file; record it in the process ledger
(`session-review` skill, step 0) so the next edit starts from it.
