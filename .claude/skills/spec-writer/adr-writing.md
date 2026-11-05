# Writing an enforceable ADR

An ADR's `Enforced-by:` header names what holds each decision. A
declaration is worth exactly as much as the evidence that its enforcer
fails when the decision is broken. A gate that passes either way, picked
because its name sounds related, is a proxy: it reads green on the
violation it was declared to catch. Four WS3 batches of
`executable-adrs` shipped proxies, and review caught each one only by
asking "would this fail if the decision were broken?"
(`docs/specs/enforceable-adr-practice.spec.md`). This file is the method
that asks that question before review does.

## The four steps, per numbered decision

1. **State a concrete violation.** Write one sentence naming an edit
   that breaks the decision: "core imports `node:fs`", "a CI step runs
   `python3` without `uv run --frozen`". If you cannot name one, the
   decision is a judgment, not a rule (see "When no plant is possible").
2. **Find the enforcer whose failure is that violation.** That is a CI gate
   (`npm run check:*` or `audit:*`) whose input contains the edit, or tests
   whose assertion would fail on it. "Covers the same area" is not
   enough; the enforcer must read the thing the edit changes.
3. **Plant it.** Apply the edit to real code or config, run the enforcer,
   read its exit status with nothing in between, and revert. For a gate
   that reads the working tree, `barwise/scripts/mutate.mjs` does all
   three: it applies the edit, runs the command, restores the file, and
   with `--expect-exit 1` exits 0 only when the command exited 1, so a
   gate that refuses (exit 2) is not mistaken for one that caught it;
   mutate refuses then. A gate that reads staged content needs the edit
   staged by hand. For tests, run only the tagged test (`vitest run -t`,
   `node --test --test-name-pattern`), so the exit code is that test's
   and not an unrelated one the plant also broke, and watch it fail.
4. **Declare only what went red.** An `npm` entry for a gate that exited
   1, a `tests` entry for tests that failed. Everything else is
   `none (<issue>: <id>)` on the decision's own gap issue: one decision
   per entry, an issue labelled `adr-gap` and titled
   `Gap: <adr> decision <id> ...`, named by no other entry.
   `check:architecture` holds the label, the title, and one decision per
   entry; `check:adr-model` holds that the issue is in the tracker and
   open.

Exit 2 is not red. A gate that refuses (could not answer) did not catch
the violation; it did not see it. Declare it only once it exits 1 on the
plant.

## What counts as a plant

- A minimal edit to real code or config, the smallest change that
  violates the decision, and nothing that also breaks something else.
  An edit that makes the build fail tells you only that the build
  failed.
- Applied, run, and reverted. It is never committed.
- In the place the enforcer actually reads. A file left untracked, when
  the gate reads `git ls-files`, proves nothing (barwise-906).

## The record, in the PR body

For each `npm` or `tests` entry the PR adds or changes, one line:

```
<adr>#<decision-id>: <the edit, in one phrase> -> <enforcer> exit 1
```

For example:
`python-from-the-lockfile#uv-bootstrap: an unpinned uv bootstrap line in ci.yml -> npm run check:python-uv exit 1`
(PR #885).

Entries the PR leaves unchanged need no line. Backfilling records for
the existing declarations is the ADR refactor session's work
(barwise-ym8.gc9). The `pr-review` checklist asks for these lines
("When an ADR changed").

## When no plant is possible

Some decisions are judgment, such as "prefer the simpler design" or "the
owner decides". No edit violates them mechanically, so no enforcer can
go red. Declare such a decision `none` on its own gap issue, and say in
the gap issue that it is a retire-to-prose candidate: the refactor
session (barwise-ym8.gc9) sorts these into build an enforcer, restate as
a checkable rule, or move to prose.
