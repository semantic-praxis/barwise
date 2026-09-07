# A reading guide to Halpin & Morgan, 3rd ed., and a check on every book citation

Status: Implemented -- the guide, the citation check and the citation
fixes landed together in one PR (the guide is a must-agree copy, and the
copy and its guard land in the same commit)
Created: 2026-09-07
Last-updated: 2026-09-07
Tracking: barwise-949 (closed after merge)

## Principle

Explicit over implicit, and the must-agree rule that follows from DRY
being secondary. The repository already tells a reader to buy the book
and cites it from five places: the Anki deck's "Read more" pointers, the
gym exercises' `reading` fields, the tutorial's closing paragraph, the
contents transcript's deck mapping, and README. What it does not have is
the thing a data engineer opening a 1,000-page text actually needs: which
chapters, in what order, and what each one grounds in the tool. That is
implicit today, scattered across a one-paragraph "key chapters" list in
`docs/anki/README.md` and the per-step citations of the tutorial.

Writing it down creates a sixth copy of section numbers whose authority
is `docs/halpin-morgan-3e-contents.md`. CLAUDE.md is unambiguous about
copies that must agree: share, derive, register, or drift-test, in the
same commit. Grounding this spec showed the rule was not being honoured by
the existing five. Three had drifted, invisibly to anyone without the
book open:

- the tutorial renderer cited the 2nd edition (regenerated into
  `docs/tutorial/order-fulfillment.md`);
- the gym exercise sent a learner to "section 3.5 (reference schemes)",
  where 3.5 is schema trimming and reference schemes are 5.3;
- the contents transcript's own deck mapping, and the seven judgment
  cards that copy it, named 7.4 for final checks, which are 7.5.

A reading guide added on top of that, with no check, would be the fourth.

## Should the guide be derived rather than written? (resolved: no)

The section numbers could be generated from the transcript, the way the
tutorial is rendered from its YAML. What cannot be generated is the
content that makes a guide a guide: the order, the verdicts on what to
skip, the habit each chapter corrects, and which barwise construct it
grounds. Deriving the numbers and hand-writing the prose around them
would split one document across two sources for a saving of a few dozen
tokens. A written guide with a drift check on its citations keeps the
document whole and makes the copy loud when it goes stale, which is the
cheaper half of the must-agree rule and the one the other five copies
should already have had.

## Scope

In scope:

- When a reader opens `docs/halpin-morgan-3e-reading-guide.md`, they
  shall find a reading order over the 3rd edition in three passes (enough
  to read a model; the CSDP end to end; objectification and mapping), a
  verdict on every remaining chapter, and for each stop on the spine what
  it grounds in barwise, which reductive reading from
  `docs/specs/learning-design.spec.md` it corrects, and where to practice
  (tutorial step, gym exercise, deck subdeck).
- When `npm run check:book-citations` runs, it shall fail on a cited
  chapter or section absent from the transcript, on a parenthetical gloss
  that names a different topic than the cited section's title, on a page
  span that is not the cited chapter's, and on a citation of the book by
  another edition; and it shall pass on the corrected tree.
- When a citation is right as written but the check cannot tell (a
  document that compares editions), it shall be allowlisted with a
  reason, and the allowlist entry shall fail the check once nothing
  matches it any more.
- When CI runs on a docs-only pull request, the check shall still run,
  since a citation edit is a docs-only change.
- The three drifted citations shall be corrected in the same commit.

Out of scope: rewriting the deck's pointers to a finer grain (they cite
the right chapters, coarsely); verifying the transcript against the
physical book (that is `docs/book-verification-checklist.md`'s job and
the transcript's own caveat); a check on quoted section _titles_ (only
parenthetical glosses are matched, because that is the form every
existing pointer uses).

## Inventory

| File                                                     | Current state                                            | Verdict                                  |
| -------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------- |
| `docs/halpin-morgan-3e-reading-guide.md`                 | does not exist                                           | new; book-scoped for the check           |
| `scripts/check-book-citations.mjs`                       | does not exist                                           | new gate, `npm run check:book-citations` |
| `scripts/tests/gates.test.mjs`                           | red-then-green tests for every gate                      | add the same for this one                |
| `docs/halpin-morgan-3e-contents.md`                      | the authority; its deck mapping names 7.4 for 7.5        | fix 7.4; link the guide                  |
| `docs/anki/07-modeling-judgment.txt`                     | seven cards copy the 7.4 pointer                         | fix 7.4                                  |
| `packages/learn/exercises/customer-order.gym.yaml`       | one check reads "ch. 3, section 3.5 (reference schemes)" | fix to ch. 5, section 5.3                |
| `packages/learn/src/tutorial/renderTutorial.ts`          | closing paragraph says 2nd ed.                           | fix; regenerate `docs/tutorial/`         |
| `docs/tutorial/order-fulfillment.md`                     | generated; carries the 2nd ed.                           | regenerated                              |
| `docs/book-verification-cc5-serialization.md`            | names a 2nd-ed section number on purpose                 | allowlisted, with the reason             |
| `.github/workflows/ci.yml`, `package.json`, root forward | gate list                                                | add the step, no docs-only skip          |
| `README.md`, `docs/anki/README.md`                       | point at the book, the deck, the transcript              | point at the guide too                   |

`docs/specs/archive/` is not scanned: an archived spec cites whichever
edition it was written against, and rewriting history to pass a gate is
the wrong fix. `.claude/skills/` is scanned, since skills are read by
agents that will act on a pointer.

## Target architecture

```
docs/halpin-morgan-3e-contents.md        the authority (transcribed TOC)
        ^                 ^
        |  existence,     |  the deck mapping inside it is checked too
        |  gloss, pages,  |
        |  edition        |
scripts/check-book-citations.mjs  <--  scans, over tracked files:
        |                                docs/**/*.md, docs/anki/*.txt,
        |                                packages/learn/**/*.{yaml,ts,md},
        |                                .claude/skills/**/*.md, README.md
        v
  ci.yml step (runs on docs-only PRs too), scripts/tests (red then green)

Citation grammar the check recognises, in a `;`-delimited segment that
names the book (or anywhere in the two book-scoped files):
  ch. N | chs. N-M | chapter N | chapters N-M        [ (gloss) ] [ pp. A-B ]
  section N.M | sections N.M-N.M | bare N.M          [ (gloss) ]
A segment stops being about the book at "barwise", "ARCHITECTURE.md",
"ORM2-0x", ...; put barwise references after a `;`.
```

## Alternatives considered

- **Extend `parity.manifest.json`.** It checks byte-for-byte agreement
  between files or symbols. Citations are not a copy of the transcript's
  bytes; they are references into it, so agreement here means
  "resolves", which needs a parser.
- **A citation front-matter block per file, checked structurally.** Would
  force every card, exercise and paragraph to restate its pointers in a
  second place, which is the drift problem again one level up. Parsing
  the prose forms already in use costs one regex per form and touches no
  existing content.
- **Checking only the new guide.** Would leave the three drifted copies
  drifted and make the fourth the only honest one. The scan is the same
  code either way; the file filter is where the scope lives.

## Workstreams

One workstream, because the copy and its guard land together (CLAUDE.md:
"in the same commit that creates the copy"). Splitting into "guide" and
"check" PRs would merge a copy with no guard, or a guard with nothing
new to guard, and the second is the one that would look done.

### 1. Guide, check, fixes, wiring

- The guide, book-scoped for the check.
- The check, its tests (green on the fixed tree from three cwds; red on a
  planted wrong section, wrong gloss, wrong page span, and wrong edition;
  red on a stale allowlist entry), the `check:book-citations` script and
  the CI step.
- The three citation fixes and the tutorial regeneration.
- Links from README, the contents transcript and the deck README.

## API and migration impact

None to any package's public API. The one source change is a string
literal in `renderTutorial.ts`; the learn package's drift test on the
committed tutorial is why `docs/tutorial/order-fulfillment.md` is
regenerated in the same commit.

## Open decisions (for review)

- **Gloss matching strength.** The check matches a gloss to a title by a
  shared word stem (one a prefix of the other, four letters or more).
  That is enough to separate "schemes" from "schema" and "trimming" from
  "trim", and it will pass a gloss that names any one word of a long
  title. The alternative, requiring every gloss word to appear, would
  reject "the constraint chapters" for chapters 4-7. Recommend the stem
  rule as landed: the check is a floor, and a false rejection is what
  makes people turn a gate off.
- **Whether the deck's coarse pointers should be refined.** Fourteen
  verbalization cards point at "chs. 4-7 (the constraint chapters)".
  Correct, and no help to a learner who failed one card. Refining them is
  deck authoring, not this spec; recommend a follow-up issue rather than
  widening this one.

## Risks and testing

- The learn package's tutorial drift test guards the regenerated output;
  `npm run build` then `npm run regen:tutorial` is the order.
- `scripts/tests/gates.test.mjs` is where the gate is shown red on
  planted defects in a throwaway repo, and green with identical coverage
  counts from three cwds (barwise-905, barwise-906).
- `npm run check:root-scripts` fails if the new script has no root
  forwarder; the forwarder is regenerated, not hand-written.
- A future transcript edit that renumbers a section will fail the check
  at every stale citer, which is the intended blast radius.

## Implementation notes (what the spec did not anticipate)

- **The gate's first green runs on the guide were vacuous.** The scan
  enumerates tracked files, and the guide was written but not yet added,
  so four "588 citations OK" runs never read it; its one wrong gloss
  ("3.2 (the CSDP)", where the title has no such word) surfaced only
  from `ci:local` after the commit. Landed in the gate itself: a
  book-scoped file that exists on disk and is untracked is now a
  failure, with its own planted-defect test. The blind spot is the one
  barwise-906 names.
- **The tracking id collided.** `barwise-940` was allocated by this
  branch and by `main` concurrently; re-filed as `barwise-949` per the
  steward skill's rule and the beads spec.
- **Two gloss rules needed a second cut before they held.** A four-letter
  prefix let "schemes" match "schema", which is the exact defect the gate
  was written for; and the section regex rejected a citation at the end
  of a sentence ("section 5.3."). Both were found by planting the defect
  first, and both are pinned in `scripts/tests/gates.test.mjs`.

## Non-goals

- No change to what the deck, gym or tutorial teach. The guide sequences
  and points; it does not restate the book.
- No verification of the transcript against the printed book; its page
  numbers stay approximate by its own caveat, and the check treats
  chapter start pages as the authority for spans.
