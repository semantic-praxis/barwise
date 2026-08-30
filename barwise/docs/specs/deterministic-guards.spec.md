# Make the guards that only diligence enforces fail on their own

Status: Draft -- no workstream implemented
Created: 2026-08-30
Last-updated: 2026-08-30
Tracking: barwise-915 (Python interpreter unpinned), barwise-916
(sqlglot tier absent from CI, tests vanish rather than fail), barwise-917
(model aliases make score rows unattributable), barwise-919 (version
pins duplicated with nothing checking they agree). Follows the ratchet
pattern of `docs/specs/duplication-drift-guards.spec.md`.

## Principle

**Explicit over implicit**, pointed at the inputs a gate depends on
rather than at the code it checks.

Four findings landed in one session, and they share a shape: a number or
a status that looked settled was a function of an undeclared input, and
nothing in the output said so. `@barwise/code-analysis` reported 95.28%
function coverage against a 90% threshold on one machine and 81.45% on
another, from identical source, because V8 omits functions it never
compiled and the Node version was not declared anywhere. The formats
suite reports `347 passed` while five tests that exercise the sqlglot
parse tier silently do not run, because the tier's dependency is
declared in no manifest. `package.json` said `engines.node >= 26.0.0`
while `package-lock.json`, which embeds its own copy, said `>= 20.0.0`,
through a fully green CI run.

Each was found by a person asking a question, and each was then closed
with a fix to the instance. That is the failure mode this spec is
against, and CLAUDE.md already names it: _"A finding is not closed by a
document ... land a check that fails when it regresses, or a baseline
row that has to be removed when it is fixed."_ Three ratchets already
follow that rule (`audit:duplication`, `audit:rubric`, `audit:specs`).
These four findings need the same treatment, and the honest reason is
that noticing cannot be mechanised -- only the cost of not noticing can.

## Should the four ship as one gate? (resolved: no)

They are one _principle_ and four _mechanisms_, and merging them would
produce a shallow module: one command whose failure output has to
explain which of four unrelated things went wrong.

Two of them are not gates at all in the end state. The strongest fix for
the model-alias finding is not a check that rejects a bad value -- it is
recording the value the provider reports instead of the one the operator
typed, so the bad value cannot be produced. That is "define errors out
of existence", and it retires the finding rather than policing it.
Similarly, the skip-count problem needs a _baseline_, while the pin
problem needs _derivation_ wherever possible and a baseline only for the
residue.

So: four workstreams, two new baselines, one extension of an existing
manifest, one behavioural change in `@barwise/llm`. They share this
spec because they share the argument, not an implementation.

## Scope

In scope:

- When a test that previously ran is skipped, and its file and count are
  not declared in `skip-baseline.json`, the system shall fail
  `npm run audit:skips -- --check`.
- When a declared skip no longer occurs, the system shall fail the same
  check, so a fixed entry must be removed.
- When two files pin the same value and disagree, the system shall fail
  `npm run check:parity`, using field-level members in
  `parity.manifest.json`.
- When a provider completes a request, the system shall record the model
  identifier the provider reports, not the one the caller requested.
- When a version input has no declared authority, or a workflow names a
  floating runner image, and it is not declared in
  `pins-baseline.json` with a reason, the system shall fail
  `npm run check:pins -- --check`.

Out of scope:

- **The path-boundary lint** (barwise-918). A rule enforcing that
  dev-time scripts resolve from the repo root while runtime code keeps
  the `argv[1]`-plus-marker search has nothing to enforce against until
  the two helpers exist. It lands with them, not here.
- **Testing `LspJsonRpc`** (barwise-914). Its two `exclude` entries in
  `packages/code-analysis/vitest.config.ts` already function as a
  standing declaration that the code is untested; no ratchet is needed
  to keep that visible.
- **Choosing the Python version.** barwise-915's pin is a prerequisite
  the `check:pins` workstream consumes, not something this spec decides.
  See Open decisions.

## Inventory

| Area                                                   | Current state                                                          | Verdict                        |
| ------------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------ |
| `scripts/audit-duplication.mjs`                        | ratchets copies against `audit-baseline.json`, fails both ways         | untouched; pattern source      |
| `scripts/audit-rubric.mjs`                             | ratchets rubric checks against `rubric-baseline.json`, fails both ways | untouched; pattern source      |
| `scripts/check-parity.mjs`                             | compares whole files and named top-level symbols                       | extended: field members        |
| `barwise/parity.manifest.json`                         | six sets, all file-or-symbol members                                   | extended: new pin sets         |
| `packages/formats/tests/SqlglotBridge.test.ts`         | 8 tests, 5 `it.runIf(available)`; 5 skip in CI                         | declared in baseline           |
| `packages/dbt/tests/sql/SqlglotBridge.test.ts`         | 6 tests, 3 `it.runIf(available)`; 3 skip in CI                         | declared in baseline           |
| `packages/promptlab/tests/recordedEvidencePin.test.ts` | `describe.skipIf(!existsSync(ROUND))`                                  | runs; round is tracked         |
| `packages/llm/src/providers/anthropic.ts`              | `modelUsed: this.model`, two sites; SDK `Message.model` discarded      | records `response.model`       |
| `packages/llm/src/providers/openai.ts`                 | `modelUsed: this.model`, two sites; `ChatCompletion.model` discarded   | records `response.model`       |
| `packages/llm/src/providers/ollama.ts`                 | one site; `OllamaChatChunk` declares no `model` field at all           | widen type; closes nothing     |
| `.nvmrc`, `package.json`, `package-lock.json`          | three copies of the Node version; only the lock is derived             | two registered as a pin set    |
| `.github/workflows/{ci,release}.yml`                   | `runs-on: ubuntu-latest` in both; Node from `.nvmrc`                   | image pinned by `check:pins`   |
| `scripts/ci-local.mjs`                                 | parses gates out of `ci.yml`                                           | untouched; picks gates up free |

Two things look affected and are not. `packages/core/tests/annotation/OrmYamlAnnotator.test.ts` matches a grep for `.todo`, but those are assertions on an annotator's `todoCount`, not skipped tests. And `packages/promptlab/tests/recordedEvidencePin.test.ts` guards on a directory that **is** tracked -- 123 files under `eval-payloads/20260828-1647` -- so its block runs; it is declared in the baseline as a conditional that currently resolves true, which is exactly the case a ratchet must catch if it ever flips.

## Target architecture

```
npm run audit:skips -- --check
  vitest --reporter=json per package
    -> { file, total, passed, pending }         (verified: numPendingTests)
  compare against skip-baseline.json
    entry: "<pkg>/<test file>": { skipped: N, verdict: "tracked:<id>" | "accepted-benign: <why>" }
  fail on: an undeclared skip  AND  a declared skip that no longer happens

npm run check:parity                            (extended, not new)
  parity.manifest.json members gain a third form:
    { "file": "package.json",      "field": "engines.node" }
    { "file": "package-lock.json", "field": "packages[\"\"].engines.node" }
                                            ^ npm's key for the root package
  string member  -> whole file        (existing)
  {file,symbol}  -> named declaration (existing)
  {file,field}   -> resolved value    (new)

@barwise/llm providers
  modelUsed: response.model ?? this.model
    the provider's own answer wins; the request string is the fallback
    for a provider that does not echo one

npm run check:pins -- --check
  version inputs:  .nvmrc / .python-version declared and read by both workflows
  runner images:   runs-on names a version, never *-latest
  exceptions:      pins-baseline.json -- an input deliberately left floating,
                   each row carrying why, same both-ways semantics
```

## Alternatives considered

- **Lower the coverage threshold instead of pinning Node.** Rejected
  before this spec, in PR #405: it treats a measurement problem as a
  standards problem, and leaves the number still a function of the
  runtime. Recorded here because it is the tempting move and will be
  tempting again.

- **Refuse an alias model id in `appendScore`.** This was the original
  proposal and it is worse than recording the provider's answer. It
  puts provider-specific naming taxonomy inside `@barwise/promptlab`,
  which knows nothing about providers; it makes the operator type a
  dated identifier for a convenience the API already offers; and it
  fails _after_ a paid run, which is the most expensive possible moment
  to reject something. Kept as a fallback only for a provider that
  echoes the alias back verbatim (see Open decisions).

- **Install sqlglot in CI and make the `runIf` unconditional there.**
  Not rejected -- genuinely open, and carried to Open decisions. It
  fixes the finding at the root rather than declaring it, at the cost of
  a Python dependency in the JavaScript lane. The baseline is worth
  having either way: it catches the _next_ silently-vanishing suite,
  which installing one package does not.

- **One `check:pins` covering both unpinned and divergent pins.**
  Rejected on orthogonality. Divergence between two declared values is
  what `parity.manifest.json` already means; giving `check:pins` a
  second, parallel notion of "these two must agree" duplicates the
  mechanism this repo built for exactly that.

## Workstreams (each independently shippable)

### 1. Field-level members in `parity.manifest.json`

Smallest blast radius: it extends one script and adds manifest rows, and
it has a demonstrated failure to close. `check-parity.mjs` gains a third
member form, `{ "file": ..., "field": ... }`, resolving a dotted path in
a JSON file to a value and comparing values rather than text.

Registers the Node-version set (`package.json#engines.node` against
`package-lock.json`'s embedded copy) and the monorepo-version set (the
thirteen `version` fields). The second is the larger win: today exactly
one of those thirteen copies is guarded, by a drift test in
`packages/mcp/tests/server.test.ts`.

Acceptance: when `package.json` and `package-lock.json` disagree on
`engines.node`, the system shall fail `npm run check:parity` naming both
files and both values. Verified by reproducing commit `0f8bdaa`'s state
and observing the check fail, then pass on `ba5c974`.

### 2. Record the model the provider reports

Independent of the ratchets and the only behavioural change here. The
five `modelUsed: this.model` sites become `response.model ?? this.model`.
The three providers are **not** the same case, and flattening them was an
error in an earlier draft of this spec:

| Provider  | Response carries a model?                   | Does this close the finding?                     |
| --------- | ------------------------------------------- | ------------------------------------------------ |
| Anthropic | yes, SDK `Message.model`                    | only if the API resolves the alias -- unverified |
| OpenAI    | yes, `ChatCompletion.model: string`         | yes                                              |
| Ollama    | no -- `OllamaChatChunk` declares no `model` | no; the tag is all `/api/chat` returns           |

Ollama needs the declared chunk type widened to read the field at all,
and even then the value is the tag the operator typed. Resolving a tag to
a digest is a separate `/api/show` call, which is out of scope here.

**Provisional: one fact is unverified.** Whether the Anthropic API
resolves an alias to a dated snapshot in its response, or echoes the
alias, needs one live call to settle. The change is correct either way
-- the provider's answer is never less accurate than the request string
-- but if it echoes the alias, the finding is only half closed and the
fallback in Open decisions applies.

Acceptance: when a completion is requested with an alias identifier and
the provider reports a resolved one, the system shall record the
resolved identifier in `ScoreRecord.model` and in the call log.

### 3. `audit:skips` and `skip-baseline.json`

A skipped test and a passing test read identically in a summary line;
that is how eight sqlglot tests disappeared under `347 passed`. The
baseline makes each conditional skip a declared row with a verdict,
following `rubric-baseline.json` exactly: `tracked:<issue>` for an open
finding, `accepted-benign: <reason>` otherwise.

Mechanism is verified: `vitest run --reporter=json` emits
`numTotalTests`, `numPassedTests` and `numPendingTests` per run and
per-test `status` per file. Measured directly on
`packages/formats/tests/SqlglotBridge.test.ts`: total 8, passed 3,
pending 5, matching CI's reported `8 tests | 5 skipped`.

Acceptance: when a test file's skip count differs from its baseline
entry in either direction, the system shall fail
`npm run audit:skips -- --check`, naming the file and both counts.

### 4. `check:pins` (provisional: not yet grounded)

Consumes barwise-915's `.python-version`, so it lands after that pin
exists. Asserts that each language runtime has exactly one declared
authority read by both workflows, and that `runs-on` never names a
floating image. Residue goes in `pins-baseline.json` with the same
both-ways semantics.

Wiring is one line in `ci.yml` plus a `package.json` script; `ci-local`
parses its gate list out of `ci.yml`, so it picks the gate up with no
further change, and `check:root-scripts` requires the regenerated root
forwarder in the same commit.

## API and migration impact

- `CompletionResponse.modelUsed` changes meaning from "what was
  requested" to "what the provider reports, falling back to what was
  requested". The type is unchanged; the docblock must say this, because
  a reader comparing an old score row against a new one otherwise sees a
  model change that never happened.
- Existing `ScoreRecord` rows keep the requested string. Rows are not
  migrated: the honest reading of an old row is that it does not know,
  which is how every other optional field in that record already behaves.
- `parity.manifest.json` gains a member form. Existing entries are
  untouched, and `check-parity.mjs`'s rule that an unresolvable member is
  an error extends to an unresolvable field path.
- No package boundary moves; no public export changes.

## Open decisions (for review)

- **sqlglot in CI, or declared as absent?** Installing a pinned sqlglot
  makes eight tests actually run and closes barwise-916 at the root, at
  the cost of a Python dependency in the JavaScript lane and some CI
  time. Declaring it in `skip-baseline.json` is free and leaves the tier
  unexercised. _Recommendation: both._ Install it, because a bridge
  whose real parse path never runs in CI is not tested; and keep the
  baseline, because it catches the next vanishing suite regardless.

- **What to do if a provider echoes the alias back.** If workstream 2
  finds the response carries the alias verbatim, the options are a
  warning at record time, a refusal, or accepting that the row names a
  family rather than a snapshot. _Recommendation: warn, do not refuse_ --
  a refusal after a paid run destroys the result it was protecting.

- **Is Ollama worth closing?** Recording the provider's answer fixes
  OpenAI outright and Anthropic probably, and leaves Ollama naming a
  mutable tag. Resolving it needs a second `/api/show` call per run to
  fetch the digest. _Recommendation: leave it open and say so in the
  docblock._ Ollama is the local-development provider; no swept score
  history runs through it, and a per-run extra call to close a gap
  nobody is measured on is a poor trade.

- **Does `check:pins` cover action refs?** The workflows use
  `actions/*@v7`, mutable major tags. SHA-pinning is a supply-chain
  posture question, not a reproducibility one, and `.npmrc` shows this
  repo already takes supply chain seriously. _Recommendation: out of
  scope here_, tracked separately, so this gate stays about
  reproducibility.

- **Which Python version.** 3.13.12 is verified: the committed
  `uv.lock` syncs against it with no re-lock and all 99 optimizer tests
  pass. 3.14 is unverified here -- this container's `uv` fetches only
  `3.14.0rc2`, on which the stack fails with a pydantic/`typing`
  mismatch specific to the release candidate, while pydantic 2.13.5
  classifies 3.14 and dspy allows `<3.15`. _Recommendation: pin 3.13
  now, open 3.14 as a follow-up_ rather than blocking the gate on a
  version nobody here can test.

## Risks and testing

- **A baseline that only fails one way becomes a landfill.** Both new
  baselines must fail on a stale entry as well as a new one, which is
  what makes fixing a finding force its row out. `audit-rubric.mjs`
  documents this property and is the reference implementation.
- **Every new gate must be mutation-verified.** Each workstream lands
  with evidence of the check _failing_ on a planted defect, not only
  passing on a clean tree. Two gates in this repo's recent history
  passed on their own defect (barwise-906, barwise-910); a gate is not
  verified until it has been seen red.
- **Workstream 3 must not slow the suite meaningfully.** It reads a JSON
  reporter over runs the suite already performs; if it doubles test time
  it is the wrong implementation.
- **Workstream 2 touches the paid path.** Its tests go through the
  existing offline fake server (`packages/cli/tests/workspace/fakeOllama.ts`
  and the llm package's provider tests), never a live call, except the
  single call needed to settle the alias-resolution question.
- Run `npm run ci:local` after each; the coverage thresholds in
  `@barwise/llm` are tight enough (92% functions) that a new branch in a
  provider needs its test in the same PR.

## Non-goals

- No new capability on any surface; the capability matrix is unchanged.
- No change to how scores are computed, weighted or compared -- only to
  which model identifier a row carries.
- No attempt to detect a test that runs but asserts nothing. That is the
  `assertion-audit` skill's territory and a different failure.
- No retroactive migration of recorded history.
