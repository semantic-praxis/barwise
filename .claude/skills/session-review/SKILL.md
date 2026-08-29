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
is the work; it is not a landing for a process gap.

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
