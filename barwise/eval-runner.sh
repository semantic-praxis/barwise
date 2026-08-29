#! /usr/bin/env bash
#
# One keyed eval round. Run from `barwise/`, with ANTHROPIC_API_KEY
# exported (never passed as an argument -- it lands in shell history).
#
# The arm table near the bottom is edited per round and committed with
# the round's record, so what ran is recoverable from the record itself.
# Procedure and judgment calls: docs/local-eval-runbook.md.

set -euo pipefail

# One stamp per round. Override to RESUME an interrupted round --
# `STAMP=20260829-0930 ./eval-runner.sh` re-enters the same directory and
# skips the arms that finished. Minted fresh otherwise, which is what
# keeps two rounds from overwriting each other by run index.
STAMP="${STAMP:-$(date '+%Y%m%d-%H%M')}"
ROUND="eval-payloads/${STAMP}"

# Preflight, both free, both paid for once already. A row written off a
# modified tree names a commit that never produced it, and the `barwise`
# bin reads `dist`, so an unbuilt checkout measures the previous build
# while the footer names this suite version.
# Captured separately, not inlined into the test: a failed `git
# status` produces empty output, which an inline `-n` test reads as
# a CLEAN tree -- so a broken git would wave through the guard whose
# whole job is to stop a run that records a commit.
if ! dirty="$(git status --porcelain)"; then
  echo "git status failed; refusing to run rather than assume a clean tree" >&2
  exit 1
fi
if [[ -n "${dirty}" ]]; then
  echo "working tree is dirty -- commit or stash first (history rows record the commit)" >&2
  exit 1
fi
npm run build >/dev/null

mkdir -p "${ROUND}"

# The recorded concurrency: case chains in parallel, repeats within a
# case serial, first call alone for the cache write.
concurrency_for() { if [[ "$1" = "dev" ]]; then echo 3; else echo 7; fi; }

# run_arm <name> <split> [extra barwise flags...]
#
# Writes payloads to $ROUND/<name>/ and the log to $ROUND/<name>.log.
# A `.done` marker (not the log) marks completion, so a resumed round
# re-runs an arm that died mid-sweep rather than trusting its partial log.
run_arm() {
  local name=$1 split=$2
  shift 2
  if [[ -f "${ROUND}/${name}.done" ]]; then
    echo "== ${name}: already complete in this round, skipping"
    return
  fi
  # Resolved to its own variable rather than inlined into the npx call:
  # a substitution nested inside another command throws its exit status
  # away, which is the shape that made the dirty-tree guard above read a
  # failed `git status` as a clean tree.
  local concurrency
  concurrency="$(concurrency_for "${split}")"
  echo "== ${name} (${split} split)"
  npx barwise prompt eval --provider anthropic \
    --split "${split}" --repeat 5 --concurrency "${concurrency}" --verbose \
    --save-payloads "${ROUND}/${name}" "$@" 2>&1 | tee "${ROUND}/${name}.log"
  touch "${ROUND}/${name}.done"
}

# --- The round --------------------------------------------------------
#
# Two independent experiments; ARMS picks which runs.
#   candidate  the compiled DSPy candidate vs a fresh default control
#   thinking   haiku with and without a thinking budget
#   both       one after the other, into one round
ARMS="${ARMS:-candidate}"

# The compiled-candidate measurement at suite 2.7.0. The control is run
# FRESH rather than read from the 2.6.0 rows: comparing across a suite
# bump is what the version field exists to forbid.
#
# CANDIDATE_DIR holds the exported candidate .prompt.yaml;
# CANDIDATE_VERSION is its `version:` field. Both flags are needed --
# --artifacts widens the candidate set, --artifact-version picks the
# candidate out of it rather than letting the shipped sonnet5-3 win on
# provider/model match. Confirm free, before spending anything:
#
#   npx barwise prompt artifact --provider anthropic --model claude-sonnet-5 \
#     --artifacts "$CANDIDATE_DIR" --artifact-version "$CANDIDATE_VERSION"
if [[ "${ARMS}" = "candidate" ]] || [[ "${ARMS}" = "both" ]]; then
  CANDIDATE_DIR="${CANDIDATE_DIR:-../optimizer/out}"
  : "${CANDIDATE_VERSION:?set it to the version field of the exported candidate}"

  run_arm candidate-sonnet-dev dev \
    --model claude-sonnet-5 --artifacts "${CANDIDATE_DIR}" --artifact-version "${CANDIDATE_VERSION}"
  run_arm candidate-sonnet-train train \
    --model claude-sonnet-5 --artifacts "${CANDIDATE_DIR}" --artifact-version "${CANDIDATE_VERSION}"

  run_arm default-sonnet-dev dev \
    --model claude-sonnet-5 --artifact-version default
  run_arm default-sonnet-train train \
    --model claude-sonnet-5 --artifact-version default

  # The candidate prompt travels with the round: it is not a shipped
  # artifact, so its recorded promptHash resolves to nothing unless the
  # bytes that produced it sit in the record beside the scores.
  cp "${CANDIDATE_DIR}"/*.prompt.yaml "${ROUND}/" 2>/dev/null || true
fi

# The haiku thinking probe. Both legs send the shipped haiku45-2 prompt,
# so the only thing that moves is the dial -- and the no-thinking leg is
# run rather than taken from the 2.6.0 record, for the same reason the
# candidate control is.
#
# Train, not dev: conference-reviews is the target (haiku's one
# reproducible bimodal drop) and it lives in the train half; there is no
# per-case filter, so the whole split runs. 35 calls per leg.
#
# Haiku 4.5 takes a token budget; Sonnet 5 rejects budget_tokens outright
# (its dial is effort), which is why this probe is haiku-only.
if [[ "${ARMS}" = "thinking" ]] || [[ "${ARMS}" = "both" ]]; then
  THINKING_BUDGET="${THINKING_BUDGET:-8192}"

  run_arm haiku-nothinking-train train --model claude-haiku-4-5
  run_arm "haiku-thinking${THINKING_BUDGET}-train" train \
    --model claude-haiku-4-5 --thinking-budget "${THINKING_BUDGET}"
fi

# --- The record -------------------------------------------------------
rm -f "${ROUND}"/*.done

git checkout -b "eval-round-${STAMP}"
git add "${ROUND}" packages/promptlab/evals/history.jsonl
git commit -m "log: eval round ${STAMP}"
git push -u origin "eval-round-${STAMP}"
