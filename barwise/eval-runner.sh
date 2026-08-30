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

# The compiled-candidate measurement. The control is run FRESH rather
# than read from an older round's rows: comparing across a suite bump is
# what the version field exists to forbid -- which is also why this
# comment no longer names a suite version. It said 2.7.0 through three
# bumps (2.8.0, 2.9.0, 2.10.0), and a hard-coded version here is a claim
# that goes stale every time the thing it names moves. `suite.yaml` is
# the authority, and each recorded row carries the version it ran at.
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
  # `compile.py --out` defaults to "out" and is run from optimizer/, so
  # the candidate lands here. This said `../optimizer/out` until
  # 2026-08-30 -- one level too high, a path outside the repo that has
  # never existed, so every run died inside artifact resolution instead
  # of at the flag.
  CANDIDATE_DIR="${CANDIDATE_DIR:-optimizer/out}"

  if [[ ! -d "${CANDIDATE_DIR}" ]]; then
    echo "no candidate directory at ${CANDIDATE_DIR}." >&2
    echo "  Compile one first (cd optimizer && python -m barwise_optimizer.compile)," >&2
    echo "  or point CANDIDATE_DIR at an exported candidate." >&2
    exit 1
  fi

  # The version is a field in the candidate's own file, so read it rather
  # than demand it. Asking the operator to retype a fact that is sitting
  # on disk is not "explicit over implicit" -- it is a failure case that
  # did not need to exist. Only a directory holding SEVERAL candidates
  # poses a real question, and that is the one case that still asks.
  if [[ -z "${CANDIDATE_VERSION:-}" ]]; then
    # `find | sort` in a process substitution masks both exit statuses,
    # and a silent failure here would look like "no candidates" -- the
    # same shape as the dirty-tree guard above. A glob needs neither.
    _candidates=()
    for _c in "${CANDIDATE_DIR}"/*.prompt.yaml; do
      [[ -f "${_c}" ]] && _candidates+=("${_c}")
    done
    if [[ ${#_candidates[@]} -eq 0 ]]; then
      echo "no *.prompt.yaml in ${CANDIDATE_DIR} -- has a compile finished?" >&2
      exit 1
    fi
    if [[ ${#_candidates[@]} -gt 1 ]]; then
      echo "${#_candidates[@]} candidates in ${CANDIDATE_DIR}; set CANDIDATE_VERSION to pick one:" >&2
      for c in "${_candidates[@]}"; do
        local_version="$(sed -n 's/^version: *//p' "${c}")"
        echo "  ${local_version%%$'\n'*}  (${c})" >&2
      done
      exit 1
    fi
    CANDIDATE_VERSION="$(sed -n 's/^version: *//p' "${_candidates[0]}")"
    CANDIDATE_VERSION="${CANDIDATE_VERSION%%$'\n'*}"
    if [[ -z "${CANDIDATE_VERSION}" ]]; then
      echo "${_candidates[0]} has no 'version:' field" >&2
      exit 1
    fi
    echo "candidate: ${CANDIDATE_VERSION} (from ${_candidates[0]})"
  fi

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
