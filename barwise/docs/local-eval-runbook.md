# Running the eval suite locally

The keyed runs. `barwise prompt eval` is the one command in the
repository that cannot run in CI or in an ephemeral session container:
it needs a provider key, and the runs it makes cost money. This is the
procedure for making them count, written against suite **2.6.0** and the
open workstreams of `docs/specs/eval-split-stratification.spec.md`.

**Suite 2.6.0 taught the evaluator wider shapes** (the projection and
entity-fold correspondence tiers, the vendor phone licence and
"suspen" stem -- the barwise-890 round, verified against the
2026-08-28 payloads), after **2.5.0 changed the DEV rubrics**
(references, fifteen population checks, an ambiguity budget -- the
barwise-845 close). No mean from any earlier keyed run, the recorded
2026-08-28 eight-arm baseline included, is comparable to what these
commands print today, on either split.

Every command below was executed verbatim with no key in the
environment, from `barwise/`. They parse, they print the artifact they
resolved, and they then fail on the missing credential without spending
anything -- so what is claimed here about resolution was observed, not
inferred.

## What is actually outstanding

`packages/promptlab/evals/history.jsonl` carries its first committed
rows: the 2026-08-28 eight-arm re-baseline
(docs/prompt-baseline-2.5.0-2026-08-28.md). Recorded runs append to
it; `barwise prompt history` reads it back. Where the workstreams
stand:

- **barwise-845 -- CLOSED at suite 2.5.0.** The three dev cases carry
  references generated from the 2026-08-27 sweep's best payloads, plus
  fifteen `forbids_population` checks and incident-response's
  ambiguity budget, so both halves now grade constraint semantics. The
  "After the dev runs" section below records how it was done and stays
  as the procedure for the next reference refresh (barwise-879).
- **The 2.6.0 re-baseline is the next keyed round.** The 2026-08-28
  rows were measured at 2.5.0, whose evaluator was blind to wider
  shapes (barwise-890); the offline re-read bounded the distortion but
  cannot recompute means. Until the eight arms are re-run at 2.6.0,
  the sonnet5-3-versus-default verdict stays provisional, and WS4
  prompt iteration waits on it.
- **barwise-846** (workstreams 3 and 4): author the new transcripts
  (per `docs/specs/eval-difficulty-calibration.spec.md`), re-split,
  then re-baseline both splits again on the new split.

Recording is the default now that committed rows exist. See "Record or
not" below for the one case that still wants `--no-history`.

## Preflight, all free

```sh
cd barwise
npm run build
git status --short                      # must be empty; see "dirty tree" below
(cd packages/cli && npx vitest run tests/commands/promptEvalOffline.test.ts)
export ANTHROPIC_API_KEY=...            # never --api-key, which lands in shell history
```

The offline test drives the whole command -- flags, client construction,
budget, streaming, conformance, scoring, every warning, `--save-payloads`,
the history append -- against a loopback Ollama server serving the
recorded fixtures, in about half a second
(`docs/specs/offline-eval-rehearsal.spec.md`). It is the cheapest way to
find out that the harness is broken.

Then confirm which prompt each arm will actually send. This needs no key
and it is the check that would have caught barwise-850, where every
recorded row measured the default while naming a provider and a model:

```sh
npx barwise prompt artifact --provider anthropic --model claude-haiku-4-5 >/dev/null
npx barwise prompt artifact --provider anthropic --model claude-sonnet-5 >/dev/null
```

Observed: `claude-haiku-4-5` resolves **haiku45-2**, `claude-sonnet-5`
resolves **sonnet5-3**, and anything else (`claude-sonnet-4-5-20250929`,
`claude-opus-5`) falls back to the default **1.1.0** with a stderr line
saying so.

**`--artifacts packages/llm/prompts` is no longer how you select a
variant.** `docs/handoff-2026-08-23.md` says it is; that instruction is
stale. Since barwise-850 the command resolves over `builtinArtifacts`
always, so `--provider` and `--model` alone select the shipped variant,
and pointing `--artifacts` at the directory the builtins are generated
from now merely de-duplicates back to the same answer. Use
`--artifacts` for a variant that is not shipped.

## The arms

Three prompts are worth measuring, on both splits, at `repeat 5`:
haiku45-2, sonnet5-3, and the default 1.1.0 as the baseline both variants
are supposed to beat.

The third one used to need a shadow-directory trick; since barwise-882
it is a flag. `--artifact-version default` forces the default prompt
while the model stays whatever `--model` says, and the run's first
stderr line confirms it:
`Using artifact version 1.1.0 (forced by --artifact-version; ...)`.
The same flag pins a named variant (`--artifact-version haiku45-2`),
which is how a variant is measured on the OTHER model when the
cross-model question comes up. An unknown version fails before any
call, listing what exists.

## Invoking the runner

`./eval-runner.sh` from `barwise/`, with `ANTHROPIC_API_KEY` exported --
never passed as an argument, where it lands in shell history.

The script's header carries the full table of environment knobs, their
defaults and what each decides. It is not repeated here on purpose: a
copy of it would be a must-agree pair with nothing keeping the two
honest, which is the drift this repo has a rule about. Read the header.

Enough to start:

```sh
export ANTHROPIC_API_KEY=...
./eval-runner.sh                            # the candidate arm
CANDIDATE_VERSION=mipro-3 ./eval-runner.sh  # when several candidates exist
ARMS=thinking ./eval-runner.sh              # the haiku thinking probe
```

`CANDIDATE_VERSION` is read from the candidate's own `version:` field
and only has to be set when `optimizer/out` holds more than one; the
error lists them. Until 2026-08-30 it had to be set always, and neither
it nor `CANDIDATE_DIR` nor `THINKING_BUDGET` was documented anywhere --
an operator had to reverse-engineer the invocation from mid-file
comments, and did.

## The runs

Eight runs: two prompts against two models, each on both splits. Train
is 7 cases, dev is 3, so `repeat 5` is 35 and 15 calls. Watch the first
three lines of each -- the artifact line, and whether tokens are being
read from cache.

The default arm is run on **both** models, not just one. Each variant
has to be judged against the default _on its own model_: a default
baseline measured only on haiku answers "did haiku45-2 beat the default"
and says nothing about sonnet5-3, and comparing sonnet5-3 against a
haiku default moves the model and the prompt at once -- the confound
the shadow directory exists to remove.

Two checks these blocks assume, both cheap and both already paid for
once: the run's footer must name the current suite version (an arm
whose footer says an older one ran a stale checkout -- pull and
`npm run build` first, the bin reads `dist`), and the blocks now
RECORD by default -- add `--no-history` yourself only for a throwaway
experiment ("Record or not" below governs; copying a block verbatim
into a recording round with the flag still on is how one arm of the
2026-08-28 baseline had to be re-run).

The blocks carry `--concurrency` 3 (dev) and 7 (train), the values the
recorded baseline used: case chains run in parallel (barwise-887),
repeats within a case stay serial, and the run's first call still
completes alone, so the cache economics are unchanged -- watch the
footer's cache line to confirm. A train arm drops from ~35 serial
calls of wall clock to roughly its slowest case's chain. Payloads land
as each case finishes rather than at the end of the sweep
(barwise-888), so a crash keeps what was already paid for. Expect
~2 minutes of silence at the start: the warm-up call completes alone
before the pool opens (barwise-889 will add a stderr line for it).

**A compile is `./compile-runner.sh`, from `barwise/`.** It does the
free checks before anything bills -- key exported, tree clean, `dist`
built (the Python lane shells out to it), `pytest` green -- stamps its
output under `optimizer/out/<stamp>/`, and prints which of the report's
three arms to gate on. Knobs are environment variables; `OPTIMIZER`,
`TARGET`, `PROPOSER`, `MAX_CALLS`, `SAMPLES`, `SEED_FROM`.

**Re-scoring a recorded round is a command, not a script.** After a
scorer change, `barwise prompt rescore --payloads eval-payloads/<stamp>
--format json > after.json` scores every payload under the current
build; pass an earlier result as `--baseline` to see what moved. It
crosses suite versions on purpose -- that is the question it answers --
and refuses a diff whose two sides cover different payloads. Comparing
two recorded rows is `barwise prompt compare --a <i> --b <j>`, which
prints the resolvability verdicts that used to be done by hand
(docs/specs/recorded-evidence-commands.spec.md).

**Save payloads and logs straight into the repo's dated record**, not
`/tmp`: one tree per round, `eval-payloads/<stamp>/`, holding each
arm's payload directory and its log as siblings (`<arm>/` and
`<arm>.log`). Three problems disappear at once: payload filenames are
`<case>-run<N>.json`, so a reused directory overwrites by run index
and mixes rounds silently (the 2026-08-28 verification had to re-score
every file to tell which round it came from); `/tmp` does not survive
a reboot, and a sweep's payloads are paid-for evidence; and the
transfer-to-repo step stops existing -- what the run wrote is what
gets committed. The log sits beside the payloads it is the manifest
of, under the same name, because the 2026-08-28 round split them into
`eval-runs/` under names that drifted from the arm directories'
(`haiku45-2-dev.log` beside `haiku45-dev/`), and the audit needed a
hand-written mapping to join a log to its own arm. That round's logs
stay where they landed. The tree is dprint-excluded, so raw payload
bytes commit as the model emitted them. The one `mkdir` is for `tee`,
which does not create directories; `--save-payloads` creates the arm
directories itself.

```sh
STAMP=$(date +%Y%m%d-%H%M)
mkdir -p "eval-payloads/$STAMP"

# The two shipped variants
npx barwise prompt eval --provider anthropic --model claude-haiku-4-5 \
  --split dev   --repeat 5 --concurrency 3 --verbose \
  --save-payloads "eval-payloads/$STAMP/haiku45-2-dev"   2>&1 | tee "eval-payloads/$STAMP/haiku45-2-dev.log"
npx barwise prompt eval --provider anthropic --model claude-haiku-4-5 \
  --split train --repeat 5 --concurrency 7 --verbose \
  --save-payloads "eval-payloads/$STAMP/haiku45-2-train" 2>&1 | tee "eval-payloads/$STAMP/haiku45-2-train.log"

npx barwise prompt eval --provider anthropic --model claude-sonnet-5 \
  --split dev   --repeat 5 --concurrency 3 --verbose \
  --save-payloads "eval-payloads/$STAMP/sonnet5-3-dev"   2>&1 | tee "eval-payloads/$STAMP/sonnet5-3-dev.log"
npx barwise prompt eval --provider anthropic --model claude-sonnet-5 \
  --split train --repeat 5 --concurrency 7 --verbose \
  --save-payloads "eval-payloads/$STAMP/sonnet5-3-train" 2>&1 | tee "eval-payloads/$STAMP/sonnet5-3-train.log"

# The default artifact, one control per model
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-haiku-4-5 \
  --split dev   --repeat 5 --concurrency 3 --verbose \
  --save-payloads "eval-payloads/$STAMP/default-haiku-dev"    2>&1 | tee "eval-payloads/$STAMP/default-haiku-dev.log"
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-haiku-4-5 \
  --split train --repeat 5 --concurrency 7 --verbose \
  --save-payloads "eval-payloads/$STAMP/default-haiku-train"  2>&1 | tee "eval-payloads/$STAMP/default-haiku-train.log"

npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-sonnet-5 \
  --split dev   --repeat 5 --concurrency 3 --verbose \
  --save-payloads "eval-payloads/$STAMP/default-sonnet-dev"   2>&1 | tee "eval-payloads/$STAMP/default-sonnet-dev.log"
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-sonnet-5 \
  --split train --repeat 5 --concurrency 7 --verbose \
  --save-payloads "eval-payloads/$STAMP/default-sonnet-train" 2>&1 | tee "eval-payloads/$STAMP/default-sonnet-train.log"

git add "eval-payloads/$STAMP" && git commit -m "log: eval round $STAMP"
```

**For the 2.6.0 re-baseline, all eight arms are the round** -- the
question it answers (does either variant beat the default on its own
model, measured by an evaluator that sees wider shapes) needs every
cell. If you must stage, the two sonnet arms settle the most: the
sonnet5-3 verdict is the one the 2.5.0 baseline left provisional,
while the haiku verdict was resolvable even under the old blindness.

Within an arm pair, run dev before train: it is the cheap half by call
count, and stopping after it still leaves the payloads behind.

Why each flag is there:

- `--repeat 5` -- below two samples the SD is undefined, and a run
  recorded without an error bar cannot resolve a difference against
  another row. It also turns caching on: `runSuite` caches the user
  message at `repeat >= 2` and the system prompt at two or more total
  calls.
- `--split` -- run each half separately. One row per split is what makes
  train and dev comparable as two measurements rather than blended into
  one mean.
- `--verbose` -- per-sample scores and every retry, on stderr, while the
  sweep is running. Without it a rate-limited run and a hung one look
  identical for as long as the backoff lasts, and a rubric no extraction
  can pass is invisible until the bill.
- `--save-payloads` -- keeps one sample per distinct score mode per
  case (equal after rounding to the three printed decimals; barwise-891)
  plus every unscorable one. A separate directory per arm and split,
  because the files are named `<caseId>-run<N>.json` and would otherwise
  collide.
- Not passed: `--max-tokens`, which each case derives from its
  transcript. Pass it only after a truncation warning, above the ceiling
  the warning names.
- Not passed: `--format json`. The text report names the failing rubric
  checks; `tee` keeps both halves of the output together.

### Why `--artifacts packages/llm/prompts` is not in these commands

It was the instruction until barwise-850, and it is the most likely
thing for a reader to add back. It is now a no-op on a clean tree, and
CI is what makes that true:
`packages/llm/tests/prompt/artifacts/builtins.test.ts` asserts that
`builtinArtifacts` deep-equals what `loadArtifactsFromDir` reads from
`prompts/`, element for element, and that both resolve identically for
the same queries. Since `prompt eval` now consults the builtins
unconditionally, `--provider`/`--model` alone select the shipped
variant. Verified both ways: `claude-haiku-4-5` gives haiku45-2 and
`claude-sonnet-5` gives sonnet5-3, with and without the flag.

Pass `--artifacts` when the prompt you want to measure is **not** the
one compiled in -- an unshipped variant, DSPy optimizer output, or a
`.prompt.yaml` you edited without running `npm run regen:builtins`.
A directory entry sharing a builtin's version replaces it, which is what
makes "a local edit wins" true, and is the same mechanism the shadow
directory above uses.

## The thinking dimension

`--thinking-budget <n>` (anthropic only, minimum 1024) sends extended
thinking on every call and is recorded on the history row -- a budget
changes scores without changing the prompt hash, so an unrecorded one
would make two rows indistinguishable
(docs/specs/thinking-budget-dimension.spec.md). One fact frames any
experiment with it: the recorded arms were asymmetric until now --
no parameter means thinking OFF on Haiku 4.5 and adaptive thinking ON
on Sonnet 5 -- so haiku's whole record is no-thinking haiku and the
dial is genuinely untried.

**The probe is deferred, and the arithmetic is why.** Work it before
spending, from the 2.6.0 record:

- Suite level. haiku45-2 train is 0.973 +/- 0.018, so two legs carry a
  combined margin of ~0.025. Conference is one case of seven at 0.937;
  fixing it PERFECTLY moves the suite mean 0.063/7 = **+0.009**.
  A third of the threshold, so a perfect result reads as noise.
- Case level, which is where the effect actually lives. Conference is
  0.937 with sd 0.142 at five samples: a 95% margin of 0.124 a leg,
  ~0.176 combined, against that same best-case +0.063. Also
  unresolvable.
- What would resolve it: a per-leg margin under ~0.045, which needs
  **~40 samples a leg** -- about 550 calls across both legs, since
  `eval` runs whole splits and conference is one of seven cases in
  train.

So the honest reading is that this suite cannot currently measure the
thinking dial on haiku at any price worth paying, and the blocker is
discrimination, not the dial. Two things change that, both already
queued: a `--case` filter (barwise-898) makes 40 samples cost 40 calls
instead of 280, and the barwise-846 workstream-3 transcripts give
haiku cases with real headroom. Revisit after either; until then the
flag exists, is recorded, and is unexercised on purpose.

The shape when it is worth running -- both legs on train, only the dial
moving, the no-thinking leg run fresh rather than read from an older
suite version -- is `ARMS=thinking ./eval-runner.sh`.

## Record or not

Recording is the default: the blocks above append to
`evals/history.jsonl`, which carries the committed 2026-08-28 rows,
and `barwise prompt history` reads it back. A row's `suiteVersion` is
what keeps rows either side of a bump from being compared, so
recording at a new suite version needs no ceremony beyond a clean
tree.

Add `--no-history` yourself for the one case that still wants it: a
throwaway experiment -- an unshipped `--artifacts` candidate, a
repeat-1 smoke test, a run you already know you will discard. A row
that records such a run pollutes the permanent record with a mean
nobody will act on.

Two more things about recording:

- **Dirty tree.** `resolveProvenance` records the barwise commit and
  whether the tree was modified. A row written off a modified tree names
  a commit that never produced it, and the tree is gone by the time
  anyone reads the row. Commit or stash first.
- **Incomplete runs are refused.** If any call never returned a payload,
  the append raises rather than recording a mean that rests on fewer
  samples than it claims, and the command exits 1. `--force-history`
  overrides it; prefer re-running once the provider is healthy.

## Warnings that change what you do next

- `WARNING: N run(s) were cut off at the output-token ceiling` -- what
  those runs measured is the budget, not the prompt. They are excluded,
  not scored zero. Re-run that arm with `--max-tokens` above the figure
  named.
- `WARNING: caching was requested but nothing was read back` -- every
  call is paying the 1.25x write premium for a read that never comes.
  Stop in the first minute; the prefix is either below the model's
  minimum cacheable length or changing between calls.
- `run failed (..., excluded)` with a `request=` id -- excluded from the
  mean rather than scored zero. The request id is the only handle the
  provider will accept afterwards.
- `COLLAPSE` on a sample -- below the manifest's `collapseFloor` of 0.3.
  Under 2.0.0 this was expected on `university-enrollment`, which was
  bimodal on a synonym (barwise-852). That is FIXED: since 2.1.0 the
  case licenses `CourseOffering`/`Offering`, so a collapse there -- or
  anywhere -- is now signal, not a known artifact. Read the saved
  payloads before concluding anything: an authoring bug and a genuinely
  hard case call for opposite responses.

## After a dev run: refresh the dev references

This is how barwise-845 was closed at suite 2.5.0, from the
2026-08-27 sweep's saved payloads; it stays as the procedure for the
next reference refresh (barwise-879), which is the same moves with
better payloads. For each of the three cases, take the highest-scoring
saved run (`barwise prompt score --case <id> --extraction <file>`
ranks them offline), install it under the name the regenerator
expects, and generate the reference:

```sh
cp eval-payloads/<stamp>/haiku45-2-dev/vendor-onboarding-runN.json \
   packages/promptlab/tests/fixtures/responses/vendor-onboarding.json
# ... likewise subscription-billing and incident-response
npm run regen:references          # from barwise/, after npm run build
```

The script names the cases it skipped, which is the fastest answer to
"which cases still lack a reference". Then add `reference:` to each of
the three case files, add `forbids_population` checks where the
transcript settles a constraint and a `requires_ambiguity` check to
`incident-response`, and re-run the promptlab tests. Two additions the
audit round bolted onto this step
(`docs/specs/constraint-extraction-coverage.spec.md`, workstream 1):
verbalize each new reference and read it against its transcript before
pinning (the train pass caught an answer key asserting a constraint
the transcript never settles), and add the ring `forbids_population`
check for "Incident is duplicate of Incident" -- `incident-response`
settles irreflexive explicitly, and if the best payload MISSED that
ring, record the miss as prompt-headroom evidence rather than picking
a payload for carrying it:

```sh
(cd packages/promptlab && npx vitest run)
```

The answer-key invariant is what you are checking: a recorded payload
must pass its case's full rubric. If the best sample does not, that is
a finding about the rubric or the transcript -- do not quietly weaken
the check to make the fixture pass. (Full-rubric pass, not a 1.000
score: two of the 2.5.0 dev keys pin below 1.000 because the recorded
extraction itself carries a conformance defect, and the pinned score
in `tests/scoreExtraction.test.ts` names it rather than hiding it.)

## Gap closed (barwise-882)

`prompt eval` and `prompt artifact` now take
`--artifact-version <version|default>`, which is what "The arms" above
uses for the default control. The shadow-directory recipe this section
used to carry is gone; if you are reading an old checkout that lacks
the flag, the git history of this file has it.
