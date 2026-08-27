# Running the eval suite locally

The keyed runs. `barwise prompt eval` is the one command in the
repository that cannot run in CI or in an ephemeral session container:
it needs a provider key, and the runs it makes cost money. This is the
procedure for making them count, written against suite **2.4.0** and the
open workstreams of `docs/specs/eval-split-stratification.spec.md`.

**Suite 2.1.0 through 2.4.0 landed between the last keyed run and now**
(the licence, thirteen audit-and-machinery checks, all train-side), so
no mean from the 2026-08-26 run is comparable to what these commands
will print today: the train rubrics have new denominators, and
runs that miss a newly guarded constraint score lower than the same
runs did then. Dev rubrics are untouched, which matters below.

Every command below was executed verbatim with no key in the
environment, from `barwise/`. They parse, they print the artifact they
resolved, and they then fail on the missing credential without spending
anything -- so what is claimed here about resolution was observed, not
inferred.

## What is actually outstanding

`packages/promptlab/evals/history.jsonl` **does not exist**. No run has
ever been recorded here; every recorded score lives in operators' local
files and in the dated notes under `docs/`. Two spec workstreams are
waiting on a keyed run:

- **barwise-845** (workstream 2): `vendor-onboarding`,
  `subscription-billing` and `incident-response` have no recorded
  payload, therefore no generated reference, therefore no
  `forbids_population` check. Train grades constraint semantics and dev
  grades element recall, so the two halves are not one measurement.
  **The payloads for this already exist**: the 2026-08-26 run saved six
  dev payloads (`docs/prompt-eval-2.0.0-haiku45-2026-08-26.md`), every
  dev sample passed its rubric, and the dev rubrics have not changed
  since -- so closing barwise-845 needs no new calls unless those saved
  files were lost. A fresh keyed dev run is the fallback, not the plan.
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

The third one has a wrinkle. There is no `--artifact-version` or
`--no-artifacts` flag, so with the builtins always in play the default
is reachable only by naming a model that matches no variant -- which
changes the model and the prompt at once, and answers a different
question. To hold the model fixed and force the default, shadow the
builtins with match-less copies at the same versions (a directory entry
sharing a builtin's version replaces it; an artifact with no `match`
block is never applicable, so resolution falls through to the default):

```sh
mkdir -p /tmp/default-only
python3 - <<'EOF'
import re, glob, os
for f in sorted(glob.glob("packages/llm/prompts/*.prompt.yaml")):
    t = open(f).read()
    open(os.path.join("/tmp/default-only", os.path.basename(f)), "w").write(
        re.sub(r"^match:\n(?:  .*\n)+", "", t, count=1, flags=re.M)
    )
EOF
```

Confirmed: with `--artifacts /tmp/default-only`, both
`--model claude-haiku-4-5` and `--model claude-sonnet-5` print
`Using the default prompt artifact (... matches no variant).`

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
npx barwise prompt eval --artifacts /tmp/default-only \
  --provider anthropic --model claude-haiku-4-5 \
  --split dev   --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/default-haiku-dev    2>&1 | tee /tmp/eval-logs/default-haiku-dev.log
npx barwise prompt eval --artifacts /tmp/default-only \
  --provider anthropic --model claude-haiku-4-5 \
  --split train --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/default-haiku-train  2>&1 | tee /tmp/eval-logs/default-haiku-train.log

npx barwise prompt eval --artifacts /tmp/default-only \
  --provider anthropic --model claude-sonnet-5 \
  --split dev   --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/default-sonnet-dev   2>&1 | tee /tmp/eval-logs/default-sonnet-dev.log
npx barwise prompt eval --artifacts /tmp/default-only \
  --provider anthropic --model claude-sonnet-5 \
  --split train --repeat 5 --verbose --no-history \
  --save-payloads /tmp/eval-payloads/default-sonnet-train 2>&1 | tee /tmp/eval-logs/default-sonnet-train.log
```

**Run the two haiku arms first, and stop there.** Every arm run before
the re-split is re-run at workstream 4 on the new split, so the only
runs worth making today are the ones that settle something before it:
the dev payloads barwise-845 needs, and the dispersion that decides how
many long transcripts barwise-846 workstream 3 should author. Both are
satisfiable on haiku, and haiku is the noisier of the two models -- a
dev error bar that is tight there is tight on sonnet, which is the
conservative direction for a decision about adding cases.

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

## After the dev runs: close barwise-845

The dev payloads are the point of that half -- whether they come from
the 2026-08-26 run's saved files or a fresh one. For each of the three
cases, take the highest-scoring saved run (`barwise prompt score
--case <id> --extraction <file>` ranks them offline), install it under
the name the regenerator expects, and generate the reference:

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
must pass its case's full rubric. If the best sonnet5-3 sample does not,
that is a finding about the rubric or the transcript -- do not quietly
weaken the check to make the fixture pass.

## Gap worth closing

`prompt eval` has no way to say "this model, the default prompt". The
shadow directory above works and is verified, but it is a workaround for
a missing flag, and an operator who does not know the trick will compare
the default against a variant by changing the model -- confounding the
two things the comparison exists to separate. Filed as barwise-882:
an `--artifact-version <version|default>` flag on both `prompt eval`
and `prompt artifact`, wanted before the workstream 4 re-baseline runs
the default arm on both models.
