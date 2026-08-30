#! /usr/bin/env bash
#
# One keyed eval round. Run from `barwise/`.
#
#   export ANTHROPIC_API_KEY=...        # never an argument: shell history
#   ./eval-runner.sh                    # asks for anything it needs
#   MODEL=haiku EXPERIMENT=thinking ./eval-runner.sh
#   MODEL=sonnet EXPERIMENT=candidate SPLITS=dev ./eval-runner.sh
#
# Set what you have opinions about; the rest is asked for at a menu, or
# is an error naming the choices when stdin is not a terminal.
#
#   MODEL              haiku | sonnet
#   EXPERIMENT         variant | candidate | thinking
#   SPLITS             both | dev | train
#   CANDIDATE_DIR      optimizer/out   candidate experiment only
#   CANDIDATE_VERSION  (derived)       asked when the directory holds several
#   THINKING_BUDGET    8192            thinking experiment only
#   STAMP              (now)           set it to an existing round to RESUME
#
# Each experiment runs its own control on the same model, so a round is
# always a comparison rather than a number.
#
# Refuses a dirty tree (a history row names the commit that produced it)
# and, at the end, commits the round to a new branch and pushes it.
# Procedure and judgment calls: docs/local-eval-runbook.md.

set -euo pipefail

# One stamp per round; a fresh one keeps two rounds from colliding.
STAMP="${STAMP:-$(date '+%Y%m%d-%H%M')}"
ROUND="eval-payloads/${STAMP}"

# --- What to run -----------------------------------------------------
#
# Three axes. Anything unset is asked for when stdin is a terminal, and
# is an error naming the choices otherwise.
#
#   MODEL       haiku | sonnet
#   EXPERIMENT  variant    the model's shipped prompt vs the default
#               candidate  a compiled candidate vs the default
#               thinking   a thinking budget vs none (haiku only)
#   SPLITS      both | dev | train
#
# Each experiment runs its own control, which is the point of choosing
# one: a variant measured without a same-model default answers nothing.

choose() { # choose VAR "prompt" choice...
  local var=$1 prompt=$2
  shift 2
  if [[ -n "${!var:-}" ]]; then
    [[ " $* " == *" ${!var} "* ]] || {
      echo "${var}=${!var} must be one of: $*" >&2
      exit 1
    }
    return
  fi
  [[ -t 0 ]] || {
    echo "${var} is unset and this is not a terminal. Set it to one of: $*" >&2
    exit 1
  }
  local choice
  PS3="${prompt} "
  select choice in "$@"; do
    [[ -n "${choice}" ]] && {
      printf -v "${var}" '%s' "${choice}"
      break
    }
  done
}

choose MODEL "model? " haiku sonnet
choose EXPERIMENT "experiment? " variant candidate thinking
choose SPLITS "splits? " both dev train

case "${MODEL}" in
  haiku) MODEL_ID=claude-haiku-4-5 ;;
  sonnet) MODEL_ID=claude-sonnet-5 ;;
esac

# Sonnet 5's dial is effort, not tokens: it rejects budget_tokens.
if [[ "${EXPERIMENT}" = thinking && "${MODEL}" != haiku ]]; then
  echo "the thinking experiment is haiku-only -- ${MODEL} rejects a token budget" >&2
  exit 1
fi

case "${SPLITS}" in
  both) SPLIT_LIST=(dev train) ;;
  *) SPLIT_LIST=("${SPLITS}") ;;
esac

echo "round ${STAMP}: ${EXPERIMENT} on ${MODEL} (${SPLIT_LIST[*]})"

# Guards come AFTER the selection above: a typo should not cost you a
# commit before you learn about it.
#
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

# --- The arms --------------------------------------------------------
#
# Two legs per split: the thing under test and its control. The control
# is run fresh rather than read from an older round, because across a
# suite bump the rows are not comparable.

if [[ "${EXPERIMENT}" = candidate ]]; then
  CANDIDATE_DIR="${CANDIDATE_DIR:-optimizer/out}"

  if [[ ! -d "${CANDIDATE_DIR}" ]]; then
    echo "no candidate directory at ${CANDIDATE_DIR}." >&2
    echo "  Compile one first (cd optimizer && python -m barwise_optimizer.compile)," >&2
    echo "  or point CANDIDATE_DIR at an exported candidate." >&2
    exit 1
  fi

  # Read the version from the candidate rather than demand it; only a
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
    _versions=()
    for _c in "${_candidates[@]}"; do
      _v="$(sed -n 's/^version: *//p' "${_c}")"
      _versions+=("${_v%%$'\n'*}")
    done
    if [[ ${#_versions[@]} -gt 1 ]]; then
      choose CANDIDATE_VERSION "candidate? " "${_versions[@]}"
    else
      CANDIDATE_VERSION="${_versions[0]}"
      echo "candidate: ${CANDIDATE_VERSION}"
    fi
  fi

  # Resolve before spending anything: offline, no API key, under a
  # second. Captured because the command reports on stderr, and held
  # back until failure where the list of versions is the whole point.
  if ! _probe="$(npx barwise prompt artifact --provider anthropic \
       --model "${MODEL_ID}" --artifacts "${CANDIDATE_DIR}" \
       --artifact-version "${CANDIDATE_VERSION}" 2>&1)"; then
    echo "${_probe}" >&2
    echo "candidate \"${CANDIDATE_VERSION}\" does not resolve in ${CANDIDATE_DIR}." >&2
    exit 1
  fi
fi

for split in "${SPLIT_LIST[@]}"; do
  case "${EXPERIMENT}" in
    variant)
      run_arm "variant-${MODEL}-${split}" "${split}" --model "${MODEL_ID}"
      run_arm "default-${MODEL}-${split}" "${split}" --model "${MODEL_ID}" \
        --artifact-version default
      ;;
    candidate)
      run_arm "candidate-${MODEL}-${split}" "${split}" --model "${MODEL_ID}" \
        --artifacts "${CANDIDATE_DIR}" --artifact-version "${CANDIDATE_VERSION}"
      run_arm "default-${MODEL}-${split}" "${split}" --model "${MODEL_ID}" \
        --artifact-version default
      ;;
    thinking)
      THINKING_BUDGET="${THINKING_BUDGET:-8192}"
      run_arm "thinking${THINKING_BUDGET}-${MODEL}-${split}" "${split}" \
        --model "${MODEL_ID}" --thinking-budget "${THINKING_BUDGET}"
      run_arm "nothinking-${MODEL}-${split}" "${split}" --model "${MODEL_ID}"
      ;;
  esac
done

# The candidate travels with the round: unshipped, so its recorded
# promptHash resolves to nothing without the bytes beside the scores.
if [[ "${EXPERIMENT}" = candidate ]]; then
  cp "${CANDIDATE_DIR}"/*.prompt.yaml "${ROUND}/" 2>/dev/null || true
fi

# --- The record -------------------------------------------------------
rm -f "${ROUND}"/*.done

git checkout -b "eval-round-${STAMP}"
git add "${ROUND}" packages/promptlab/evals/history.jsonl
git commit -m "log: eval round ${STAMP}"
git push -u origin "eval-round-${STAMP}"
