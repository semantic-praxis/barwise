# Running the eval suite locally

The keyed runs. `barwise prompt eval` is the one command in the
repository that cannot run in CI or in an ephemeral session container:
it needs a provider key, and the runs it makes cost money. This is the
procedure for making them count, written against suite **2.5.0** and the
open workstreams of `docs/specs/eval-split-stratification.spec.md`.

**Suite 2.5.0 changed the DEV rubrics** (references, fifteen
population checks, an ambiguity budget -- the barwise-845 close, from
the 2026-08-27 haiku45-2 sweep's saved payloads), on top of the
2.1.0-2.4.0 train-side widening. No mean from any earlier keyed run,
the 2026-08-27 sweep included, is comparable to what these commands
print today, on either split.

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
- **barwise-846** (workstreams 3 and 4): re-split, then re-baseline both
  splits at `repeat >= 5` for the default artifact and both committed
  variants, and write the first committed history rows.

Their order matters for what you pass to `--no-history`. See
"Record or not" below.

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
`claude-opus-5`) falls back to the default **1.0.0** with a stderr line
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
haiku45-2, sonnet5-3, and the default 1.0.0 as the baseline both variants
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

Two preflight checks these blocks assume, both cheap and both already
paid for once: the first stderr line must name the artifact you meant
(a variant arm that prints `suite 2.4.0` in its footer ran a stale
checkout -- pull and `npm run build` first, the bin reads `dist`), and
for the workstream 4 recording round **drop `--no-history` from every
arm** -- the flags below carry it because they were written for the
pre-baseline rounds ("Record or not" below governs).

Add `--concurrency 3` to any arm to run case chains in parallel
(barwise-887): repeats within a case stay serial and the run's first
call still completes alone, so the cache economics are unchanged --
watch the footer's cache line to confirm. A train arm drops from ~35
serial calls of wall clock to roughly its slowest case's chain.
Payloads now land as each case finishes rather than at the end of the
sweep (barwise-888), so a crash keeps what was already paid for.

```sh
# The two shipped variants
npx barwise prompt eval --provider anthropic --model claude-haiku-4-5 \
  --split dev   --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/haiku45-2-dev   2>&1 | tee /tmp/eval-logs/haiku45-2-dev.log
npx barwise prompt eval --provider anthropic --model claude-haiku-4-5 \
  --split train --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/haiku45-2-train 2>&1 | tee /tmp/eval-logs/haiku45-2-train.log

npx barwise prompt eval --provider anthropic --model claude-sonnet-5 \
  --split dev   --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/sonnet5-3-dev   2>&1 | tee /tmp/eval-logs/sonnet5-3-dev.log
npx barwise prompt eval --provider anthropic --model claude-sonnet-5 \
  --split train --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/sonnet5-3-train 2>&1 | tee /tmp/eval-logs/sonnet5-3-train.log

# The default artifact, one control per model
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-haiku-4-5 \
  --split dev   --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/default-haiku-dev    2>&1 | tee /tmp/eval-logs/default-haiku-dev.log
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-haiku-4-5 \
  --split train --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/default-haiku-train  2>&1 | tee /tmp/eval-logs/default-haiku-train.log

npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-sonnet-5 \
  --split dev   --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/default-sonnet-dev   2>&1 | tee /tmp/eval-logs/default-sonnet-dev.log
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-sonnet-5 \
  --split train --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/default-sonnet-train 2>&1 | tee /tmp/eval-logs/default-sonnet-train.log
```

**Run the two haiku arms first, and stop there.** Every arm run before
the re-split is re-run at workstream 4 on the new split, so the only
runs worth making today are the ones that settle something before it:
the dispersion that decides how many long transcripts barwise-846
workstream 3 should author (the 845 dev payloads were the other
reason, satisfied by the 2026-08-27 sweep). That is satisfiable on
haiku, and haiku is the noisier of the two models -- a dev error bar
that is tight there is tight on sonnet, which is the conservative
direction for a decision about adding cases.

What the sonnet arms buy is the variant-versus-default comparison for
sonnet5-3, and no pending decision turns on it. One thing would change
that: if haiku's best dev sample does not pass its case's full rubric,
it cannot serve as an answer key, and the sonnet **dev** arm (15 calls)
is then worth running for better payloads. Not the train arm, which
buys nothing at that point.

Within a stage, run dev before train: it is the cheap half by call
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
- `--save-payloads` -- keeps each case's best and worst scored sample
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

## Record or not

`--no-history` above is deliberate, and it is the one judgment in this
runbook. barwise-846 re-splits the suite, and its own timing note says
the re-split is nearly free while no committed rows exist and gets
monotonically more expensive the moment the first ones land. These runs
are the grounding evidence for _how many cases_ the new split needs;
they are not the baseline that split will be measured against. Keep them
in `/tmp/eval-logs/` and in a dated `docs/` note, not in
`evals/history.jsonl`.

Drop `--no-history` for the workstream 4 sweep -- after the payloads,
the references and the re-split have landed. That is when a row is worth
committing, and `barwise prompt history` is how you read the file back.

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
cp /tmp/eval-payloads/haiku45-2-dev/vendor-onboarding-runN.json \
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
