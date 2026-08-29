---
name: session-review
description: Use when opening a PR, or when closing out a work session, to extract what the session revealed about the PROCESS rather than the code - a gate that did not fire, a guard with a hole, a correction a human had to supply, a default that was wrong. Produces the "Session review" section of the PR body, where every entry names the mechanism it landed in or states that it landed in none.
---

# Session review

A PR says what changed. A session review says what the session revealed
about how the work gets done -- and, crucially, where that has been
made permanent. It goes in the PR body under `## Session review`, which
is the PR template's last section.

The rule it enforces is the one CLAUDE.md states for findings: **a
finding is not closed by a document.** An entry that ends in a
resolution is not a review entry, it is a wish.

## Step 0: read the ledger before writing anything

```sh
node scripts/beads-crud.mjs list --label process
```

Do this FIRST, every time. Session reviews live in PR bodies, which
nothing reads back -- so for as long as that was the only record, a
failure could recur three times and look new on each occasion. It took a
human reading three PR bodies in a row and asking "why do I see the same
mistakes?" to notice, and being told by a human is the signal this skill
already names as the strongest and most damning available.

The ledger is what replaces that human. Every finding that lands nowhere
is filed with `--labels process` (add a second label for the class:
`verification`, `cwd`, `gate-coverage`). The issue is **not** the
landing -- the rule below still holds -- it is the memory that makes the
next occurrence detectable as a repeat rather than a discovery.

## Repeats are a different kind of entry

If a finding matches one already in the ledger, it is a **repeat**, and
saying so is mandatory: name the issue id and the count. A repeat may
not be discharged by writing a better bullet about it. Exactly one of
these must happen:

1. **A mechanism lands this session**, and the ledger issue closes.
2. **It is escalated to the user in the reply, not just the PR body** --
   "this is the third time, the remedy needs a decision I cannot make,
   here is the decision." An issue with acceptance criteria goes with it.

What is forbidden is the third option, which is what actually kept
happening: re-describing it more precisely and moving on. Precision
about a recurring failure reads like progress and is not.

**Sweep the class, not the instance.** When a finding names a class,
the same session asks what else is in it -- and this is not
hypothetical: `check-shell`'s cwd bug was fixed on its own for a full
commit before anyone asked whether another gate had it. `check-no-nul`
did, and was scanning 1426 of 1483 tracked files in CI, silently, with
`OK` in the log. One grep would have found it at any point. An entry
that fixes one instance of a named class and does not report the sweep
is incomplete.

## What belongs

Process, not code. The bug you fixed is the PR; the reason nothing
caught the bug is the review.

- **A gate that did not fire.** A hook whose globs missed the file
  type; a check that runs in CI but has no local equivalent; a lint
  that covers `.ts` and silently not `.mjs`.
- **A correction that came from outside the work.** The strongest
  signal available, and the one most worth being honest about: if a
  human had to point something out, the work did not surface it. Two
  corrections of the same shape in one session is a pattern, not bad
  luck.
- **A guard with a hole in it**, especially one you just built. Verify
  the guard covers what you added, not merely that it passes.
- **A default that was wrong**, or a convention that existed and was
  not followed because nothing pointed at it.
- **An assumption that survived because nothing tested it** -- a check
  that cannot fail, a test that never ran, a claim in a doc that
  nothing re-derives.

## What does not belong

- The change itself. That is the rest of the PR body.
- A bug in the code, unless the interesting part is why the process
  let it through.
- Praise, narrative, or a summary of what was done.
- **Anything whose remedy is "be more careful next time".** Discipline
  is not a mechanism. If the only fix you can name is intention, say
  so explicitly and mark it unlanded -- do not dress it up.

## The form

One bullet per finding. Each names, in order: what happened, why
nothing caught it, and **where it landed**. The landing is the point.

```
- **`.mjs` bypassed the format hook.** lint-staged formats `*.ts` and
  `*.{json,md}`; dprint covers `.mjs` and CI checks it, so every `.mjs`
  edit has always reached CI unformatted with the hook reporting
  success. Landed: `*.mjs` added to lint-staged with the same
  dprint + oxlint pair.
```

Legitimate landings, roughly in descending order of durability: a CI
gate; a script with a ratchet baseline; a commit hook glob; a drift
test; a rule in CLAUDE.md or AGENTS.md; an edit to a skill so the next
session starts from it. A beads issue is a landing only when the issue
is the work; it is not a landing for a process gap -- for a process gap
it is the ledger entry, which is what step 0 reads and what makes the
next occurrence a repeat instead of a surprise.

**The most durable landing is the one that removes the choice.** A rule
says "run the aggregate before pushing"; the pre-push hook runs it. A
comment says "this listing must be anchored"; `scripts/lib/tracked.mjs`
is the only listing. A note says "check whether the flag is supported";
`beads-crud` refuses an unknown flag and names the ones that work.
Prefer the form that makes the wrong thing impossible over the form
that makes it discouraged.

**An entry that landed nowhere is allowed, and must say so plainly**
along with why -- it needs a decision you cannot make, it changes a
shared workflow the owner has not agreed to, the mechanism would cost
more than the failure. That is an honest entry. Silence about it is
not.

"Nothing this session" is a fine review when it is true. It is not
true in any session where a human corrected you.

## Worked example: what this skill came out of

The 2026-08-29 optimizer session produced four instances of one shape,
each caught by the user asking rather than by the work:

1. Fixed a red test; did not file the systemic rot that hid it for
   weeks. Landed: barwise-900.
2. Audited one check kind of four; reported the other three's control
   numbers as if they were verdicts. Landed: 47 checks actually vetted,
   two defects filed.
3. Ran the audit; left it a throwaway script. Landed:
   `audit:rubric --check`, a baseline, a CI step, and a third pass in
   the `assertion-audit` skill.
4. Pushed twice with red CI, each from a gate not run -- then assembled
   an "everything" list from memory that was itself missing five gates.
   Landed: `npm run ci:local`, which PARSES the gate list out of
   `ci.yml` rather than restating it.

The through-line is worth keeping: in every case the first three
remedies I reached for were intentions, and only the fourth form --
deriving the check from an authority that cannot drift -- actually
holds. Prefer that shape when it is available.
