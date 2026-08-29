#! /usr/bin/env bash
#
# One DSPy compile. Run from `barwise/`, with ANTHROPIC_API_KEY exported
# (never passed as an argument -- it lands in shell history).
#
# This spends money, so everything free happens first and the run refuses
# rather than guesses. Design and the arms it reports:
# optimizer/CLAUDE.md, docs/specs/dspy-optimizer.spec.md.

set -euo pipefail

# One stamp per compile, so two runs cannot overwrite each other's
# candidate or report. Override to write into an existing directory.
STAMP="${STAMP:-$(date '+%Y%m%d-%H%M')}"
OUT="optimizer/out/$STAMP"

# --- Knobs ------------------------------------------------------------
#
# No defaults for the two that cost money: --max-calls and
# --samples-per-candidate are required by compile.py on the same ground,
# and a default here would quietly reintroduce what it refuses.
TARGET="${TARGET:-anthropic/claude-sonnet-5}"
OPTIMIZER="${OPTIMIZER:-mipro}"
PROPOSER="${PROPOSER:-anthropic/claude-opus-5}"
MAX_CALLS="${MAX_CALLS:-200}"
SAMPLES="${SAMPLES:-5}"
# minimal for mipro/gepa, which propose replacements; default for
# bootstrap, which only selects demos and amplifies a weak seed.
SEED_FROM="${SEED_FROM:-}"

# --- Preflight, all free ----------------------------------------------

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "ANTHROPIC_API_KEY is not exported. Export it; never pass it as a flag." >&2
  exit 1
fi

# A candidate's provenance names a commit, so a dirty tree would record a
# revision that never produced it.
if [ -n "$(git status --porcelain)" ]; then
  echo "working tree is dirty -- commit or stash first (the candidate records the commit)" >&2
  exit 1
fi

# The Python lane shells out to packages/cli/dist, not to source. An
# unbuilt checkout has already cost a compile once, as
# `error: unknown command 'artifact'` partway in.
echo "== build (the seam runs dist, not src)"
npm run build >/dev/null

echo "== uv sync"
(cd optimizer && uv sync --extra dev >/dev/null)

# barwise-900: nothing else catches a red optimizer test -- the lane sits
# outside CI and its whole guard is "executed by hand". The minute before
# spending money is when hand-running actually pays: the loader round trip
# is what proves an exported candidate will resolve at all.
echo "== pytest (the only guard this lane has)"
(cd optimizer && uv run pytest -q)

# mipro and gepa both need a second model to propose instructions, and
# compile.py refuses at config time -- but refusing here costs nothing
# rather than costing the bootstrapping calls already spent.
PROPOSER_FLAG=()
if [ "$OPTIMIZER" != "bootstrap" ]; then
  if [ -z "$PROPOSER" ]; then
    echo "--optimizer $OPTIMIZER needs a proposer model; set PROPOSER=" >&2
    exit 1
  fi
  PROPOSER_FLAG=(--proposer-model "$PROPOSER")
fi

SEED_FLAG=()
if [ -n "$SEED_FROM" ]; then
  SEED_FLAG=(--seed-from "$SEED_FROM")
fi

mkdir -p "$OUT"

# --- The compile ------------------------------------------------------
#
# stdout carries the run's JSON report; stderr carries the per-call
# progress (barwise-897), so they are split rather than interleaved --
# `report.json` stays parseable and `compile.log` stays readable.
echo "== compile: $OPTIMIZER -> $TARGET, ceiling $MAX_CALLS calls"
echo "   progress on stderr; report.json and the candidate land in $OUT"
(
  cd optimizer && uv run python -m barwise_optimizer.compile \
    --target-model "$TARGET" \
    --optimizer "$OPTIMIZER" \
    --max-calls "$MAX_CALLS" \
    --samples-per-candidate "$SAMPLES" \
    --out "out/$STAMP" \
    ${PROPOSER_FLAG[@]+"${PROPOSER_FLAG[@]}"} \
    ${SEED_FLAG[@]+"${SEED_FLAG[@]}"}
) 2>&1 >"$OUT/report.json" | tee "$OUT/compile.log" >&2

# --- What to read, and what NOT to conclude ---------------------------
echo
echo "== done. $OUT holds the candidate, its delta report, and compile.log"
echo
echo "Read the delta report's THREE arms, and gate on the right one:"
echo "  shipped    what production sends the target model today"
echo "  baseline   the seed the search started from -- NOT what we ship"
echo "  candidate  what the compile produced"
echo
echo "The gate is 'margin over shipped'. A candidate can beat its seed"
echo "handily and still lose to production by a distance; that misreading"
echo "is barwise-899, and it is why the shipped arm is scored at all."
echo
echo "All three ran through the DSPy harness, which renders the prompt its"
echo "own way -- so they compare to each other and NOT to a recorded"
echo "\`barwise prompt eval\` row."
echo
# The verdict comes from report.json, not from grepping the delta
# report's prose. Both are rendered from one `verdict.decide`, and the
# prose is the copy whose wording nobody owns -- a reword would have made
# this block silently print nothing, which is the failure mode of every
# grep over a sentence.
python3 - "$OUT/report.json" <<'PYEOF' || true
import json, sys
try:
    v = json.load(open(sys.argv[1])).get("verdict")
except Exception as err:
    print(f"could not read the verdict from report.json: {err}")
    sys.exit(0)
if not v:
    print("report.json carries no verdict (a compile from before it was recorded?)")
    sys.exit(0)
print(f"  gate:         {v['gate']}")
print(f"  vs shipped:   {v['margin_over_shipped']:+.3f}")
print(f"  vs seed:      {v['margin_over_baseline']:+.3f}")
print(f"  resolvable:   {v['resolvable']:.3f}")
print(f"  worth gating: {v['worth_gating']}")
print()
print(f"  {v['summary']}")
PYEOF
echo
echo "If it beats shipped, the measurement round is:"
echo "  CANDIDATE_DIR=../optimizer/out/$STAMP CANDIDATE_VERSION=<version> ARMS=candidate ./eval-runner.sh"
echo
echo "Record the outcome in docs/prompt-optimization-log.md either way."
echo "A failed compile that goes unrecorded is how the same approach gets"
echo "retried later at the same price."
