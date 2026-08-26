# Test-suite assertion audit, 2026-08-26

Scoped to the `artifact-resolution-parity` workstream (PR #347), run
after it was already green in CI. Third audit in the series, following
`test-suite-assertion-audit-2026-08-25.md`.

**Result: three findings, all in code this workstream added, all fixed
here. One of them is the `assertion-audit` skill's own headline defect
reproduced by the session that wrote the skill's trigger conditions
into a spec.**

The finding worth carrying forward is not any of the three. It is that
the skill's rule 1 catches a _name_, and the defect it was written
about lives in the _probe value_.

## Why this audit ran at all

The workstream added a capability to a surface (`barwise prompt run`)
and wrote refusal tests. That is two of the skill's three triggers. It
also mutation-checked every new assertion during implementation --
eleven mutations, ten caught, one documented as unkillable -- so the
question this audit answers is what that discipline still missed.

It missed three things, which is a useful calibration: per-assertion
mutation testing during authoring is not a substitute for the two
passes, because it only ever asks "does a test cover this line". It
never asks "is the behaviour this test defends the behaviour we want".

## Findings

### 1. A refusal test named for what is built, not why the input is invalid

`packages/cli/tests/commands/promptRun.test.ts:173` (as authored):

```ts
it("rejects a surface it cannot run", async () => {
  ... runCli(["prompt", "run", modelFile, "--surface", "agent"]);
```

This is rule 1's anti-pattern verbatim, and near-verbatim the string
from the precedent: PR #338's finding was `it("rejects a surface it
cannot print")`. Its own two siblings, written _after_ that lesson, are
named `it("rejects a surface that is not a surface")` -- so the new
test was inconsistent with the convention sitting six lines away in a
file the same session had edited.

Fixed: renamed to match its siblings.

### 2. The probe value is a planned member of the union under test

Sharper than finding 1, and the reason finding 1 mattered. All three
surface-taking commands probed with `--surface agent`:

| test                                     | probe     |
| ---------------------------------------- | --------- |
| `prompt.test.ts:129` (`prompt schema`)   | `"agent"` |
| `prompt.test.ts:204` (`prompt artifact`) | `"agent"` |
| `promptRun.test.ts:173` (`prompt run`)   | `"agent"` |

`agent` is not a nonsense value. `docs/specs/prompt-optimization-harness.spec.md`
workstream 6 is "Agent-output evals for the `.claude/` subagents", and
`PromptSurface` is the union it would extend. So the day that ships,
three commands refuse it and three tests assert the refusal is correct
-- barwise-855 reproduced exactly, with the two correctly-named tests
participating.

**A test can be named honestly and still pin a limitation, if the value
it feeds is one the system is expected to grow into.** Rule 1 governs
names; nothing governed the fixture. That is the gap this audit found
in the skill, not just in the code.

Fixed two ways:

- The probe is now `"not-a-surface"`, which nothing plans to become.
- More usefully, **the defect is designed out rather than tested for.**
  `PROMPT_SURFACES` is declared once in `PromptArtifact.ts` with the
  type derived from it, and the three CLI guards call one `parseSurface`
  that validates against the list and builds its error message from it.
  Adding a surface to the union now makes the commands accept it with
  no edit, and the error message cannot go stale.

  Verified by adding `"agent"` to the union and rebuilding: the CLI
  accepts `--surface agent` immediately, and `selectArtifact.ts` fails
  the build with two errors naming exactly the tables that need the new
  member (`DEFAULT_FOR`, `DRIVES`). A surface can no longer be
  half-added -- either the build is red or the surface works.

- `loadArtifact.ts:12` was found carrying a second copy of the list,
  typed `readonly PromptSurface[]`. That type catches a _removed_
  member and says nothing about an added one, so the loader would have
  silently rejected a valid new-surface artifact file. Collapsed into
  the one declaration.

### 3. A flag observed only at `--help`, not on the wire

Pass 2, mutation M-C: deleting the `--model` passthrough in `prompt
run` left all 26 tests in the two affected files green.

Rule 3 is explicit that a flag is not covered until its value is
observed at the far end, and this workstream's own tests read the
_system prompt_ off the loopback server while never reading the
_model_. Not cosmetic: artifact resolution keys on `client.model`
(barwise-842 is the precedent -- resolving from flags rather than the
client silently measured the default), so a `--model` that never
reaches the client changes which prompt gets measured, quietly.

Fixed: `promptRun.test.ts` now asserts `fake.requests[0].model` is
`"fake-local"`. Kill verified by re-running M-C -- 1 failed of 31.

## Mutations run, and what they say

| #  | mutation                                                       | outcome                |
| -- | -------------------------------------------------------------- | ---------------------- |
| A  | `llm-usage` never names hashes (always the count branch)       | caught                 |
| B  | `promptlab` carries an 8-char divergent `hashPrompt` copy      | caught                 |
| B2 | `promptlab` carries a 12-char divergent copy (trims input)     | caught                 |
| C  | `prompt run` drops the `--model` passthrough                   | **survived**           |
| D  | add `"agent"` to `PromptSurface` (structural check, not a bug) | build red, CLI accepts |

B and B2 together clear rule 5 for the `hashPrompt` move: the call log
and the score history must agree on what identifies a prompt, and a
divergent copy in `promptlab` is caught by `promptlab`'s own
behavioural tests rather than by a correspondence test. B alone would
have been a weak clear -- it was caught only by a `{12}` length regex,
which a same-length copy passes. B2 is the one that settles it.

## Negative results

Worth recording, since a pass that only reports hits says nothing about
its own coverage.

- **Pass 1a is clean of this workstream's doing.** The four new
  `cannot drive` hits are `assertArtifactSurface`'s message, and a
  review artifact genuinely cannot drive extraction -- a permanent
  semantic invariant, not a build limitation. Requirement, not
  limitation.
- **The 2026-08-25 audit's one real finding is gone.**
  `prompt.test.ts:117` pinning `"extraction only"` no longer exists;
  barwise-855 item 1 shipped. Re-grepping confirmed it.
- **`runSuite`'s surface guard is still covered.**
  `promptlab/tests/runSuite.test.ts:230` rejects a review artifact, and
  survived the guard being routed through the exported
  `assertArtifactSurface`.
- **The other pass-1a hits are the same false positives the previous
  audit cleared** (annotator fixture text, snowflake CHECK, "if and
  only if" verbalization prose) -- the test supplies the string in each
  case.

## Watch items

- **Surface dispatch is still hand-written even though validation is
  not.** Four ternaries in `cli/src/commands/prompt.ts` (the fallback
  artifact, `render`, and two in `prompt run`) read `surface ===
  "review" ? ... : ...`, so a third surface would silently route to
  extraction. Deliberately not fixed: building a per-surface record for
  a surface that does not exist is speculative, and the tripwire is
  adequate -- `selectArtifact`'s two `Record<PromptSurface, ...>` tables
  fail the build first, so nobody reaches those ternaries without
  already editing the surface plumbing. Revisit when a third surface is
  actually authored.
- **One mutation remains unkillable by construction** (carried from the
  workstream): with `includeAlternatives` false, `buildSystemPrompt` and
  `buildReviewSystemPrompt` reduce to the same expression, so swapping
  one for the other is undetectable. The branch is kept with a comment
  saying why it must not be "simplified" away.
- **`vscode`'s `ToolRegistration` still has no completeness pin**,
  carried unchanged from the 2026-08-25 audit's watch items.

## What this suggests for the skill

Rule 1 should extend from names to fixtures. A candidate wording:

> **Refusal probes must use a value the system will never accept.**
> Check the value against the union it is probing and against any spec
> that plans to extend it. `"agent"` looks like a nonsense surface and
> is a scheduled one; `"not-a-surface"` is safe. A correctly named test
> fed a soon-to-be-valid value is still a pinned limitation.

Not applied to the skill in this PR -- the skill is shared tooling and
editing it is its own change, with its own review.
