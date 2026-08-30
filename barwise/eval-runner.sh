#! /usr/bin/env bash
#
# One keyed eval round. Run from `barwise/`.
#
#   export ANTHROPIC_API_KEY=...        # never an argument: shell history
#   ./eval-runner.sh                    # the candidate arm
#   CANDIDATE_VERSION=mipro-3 ./eval-runner.sh
#   ARMS=thinking ./eval-runner.sh
#
# Every knob, its default, and what it decides:
#
#   ARMS               candidate    which experiment: candidate | thinking | both
#   CANDIDATE_DIR      optimizer/out  where compile.py wrote the candidate
#   CANDIDATE_VERSION  (derived)    read from the candidate's own `version:`
#                                   field; required only when the directory
#                                   holds several, and the error lists them
#   STAMP              (now)        set it to an existing round to RESUME:
#                                   finished arms are skipped
#   THINKING_BUDGET    8192         thinking arm only; haiku takes a token
#                                   budget, sonnet rejects it outright
#
# The script refuses a dirty tree (a history row names the commit that
# produced it) and, at the end, commits the round to a new branch and
# pushes it.
#
# The arm table near the bottom is edited per round and committed with
# the round's record, so what ran is recoverable from the record itself.
# Procedure and judgment calls: docs/local-eval-runbook.md.

set -euo pipefail

# One stamp per round; a fresh one keeps two rounds from colliding.
STAMP="${STAMP:-$(date '+%Y%m%d-%H%M')}"
ROUND="eval-payloads/${STAMP}"

# A row written off a modified tree names a commit that never produced
# it, and the `barwise` bin reads `dist`, so an unbuilt checkout scores
# the previous build. Status is captured separately because an inlined
# `-n "$(git status)"` reads a FAILED git as a clean tree.
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

# Case chains in parallel; repeats within a case stay serial.
concurrency_for() { if [[ "$1" = "dev" ]]; then echo 3; else echo 7; fi; }

# run_arm <name> <split> [extra barwise flags...]
# A `.done` marker rather than the log marks completion, so a resumed
# round re-runs an arm that died mid-sweep.
run_arm() {
  local name=$1 split=$2
  shift 2
  if [[ -f "${ROUND}/${name}.done" ]]; then
    echo "== ${name}: already complete in this round, skipping"
    return
  fi
  # Its own variable: a substitution nested in another command throws
  # its exit status away.
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

# The control is run fresh rather than read from an older round: across
# a suite bump the rows are not comparable, which is what the version
# field is for.
#
# Both artifact flags are needed -- --artifacts widens the candidate set,
# --artifact-version picks from it rather than letting the shipped
# sonnet5-3 win on provider/model match.
if [[ "${ARMS}" = "candidate" ]] || [[ "${ARMS}" = "both" ]]; then
  # `compile.py --out` defaults to "out", run from optimizer/.
  CANDIDATE_DIR="${CANDIDATE_DIR:-optimizer/out}"

  if [[ ! -d "${CANDIDATE_DIR}" ]]; then
    echo "no candidate directory at ${CANDIDATE_DIR}." >&2
    echo "  Compile one first (cd optimizer && python -m barwise_optimizer.compile)," >&2
    echo "  or point CANDIDATE_DIR at an exported candidate." >&2
    exit 1
  fi

  # Read the version from the candidate rather than demand it. Only a
  # directory holding several poses a real question.
  if [[ -z "${CANDIDATE_VERSION:-}" ]]; then
    # A glob, not `find | sort`: a process substitution masks the exit
    # status, so a failing find would read as "no candidates".
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

  # Resolve the artifact before spending anything: offline, no API key,
  # under a second. Otherwise a bad version surfaces inside the first arm.
  if ! npx barwise prompt artifact --provider anthropic --model claude-sonnet-5 \
       --artifacts "${CANDIDATE_DIR}" --artifact-version "${CANDIDATE_VERSION}" >/dev/null; then
    echo >&2
    echo "candidate \"${CANDIDATE_VERSION}\" does not resolve in ${CANDIDATE_DIR} (see above)." >&2
    echo "  Set CANDIDATE_VERSION to one of the versions listed, or unset it to" >&2
    echo "  derive it when the directory holds exactly one candidate." >&2
    exit 1
  fi

  run_arm candidate-sonnet-dev dev \
    --model claude-sonnet-5 --artifacts "${CANDIDATE_DIR}" --artifact-version "${CANDIDATE_VERSION}"
  run_arm candidate-sonnet-train train \
    --model claude-sonnet-5 --artifacts "${CANDIDATE_DIR}" --artifact-version "${CANDIDATE_VERSION}"

  run_arm default-sonnet-dev dev \
    --model claude-sonnet-5 --artifact-version default
  run_arm default-sonnet-train train \
    --model claude-sonnet-5 --artifact-version default

  # The candidate travels with the round: unshipped, so its recorded
  # promptHash resolves to nothing without the bytes beside the scores.
  cp "${CANDIDATE_DIR}"/*.prompt.yaml "${ROUND}/" 2>/dev/null || true
fi

# Both legs send the shipped haiku45-2 prompt, so only the dial moves.
# Train, not dev: the target is conference-reviews (haiku's one
# reproducible bimodal drop) and it lives in train. 35 calls per leg.
# Haiku-only because Sonnet 5 rejects budget_tokens outright.
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
