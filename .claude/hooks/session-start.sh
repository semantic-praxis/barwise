#!/bin/bash
set -euo pipefail

# Web-session bootstrap: install the monorepo dependencies and the uv
# toolchain for the prompt-optimization lane. Local environments manage
# their own setup.
if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR}/barwise"

# SessionStart hands this script a JSON payload on stdin whose `source` is one
# of startup, resume, clear, compact. Only `startup` is a cold container, where
# the install and the build do real work and their log is what a failure has to
# be read from. The other three re-run against a warm container, so the build is
# a cache hit -- measured at ~110ms, twelve "cache hit, replaying logs" lines and
# a FULL TURBO footer -- and that output is reprinted into the agent's context
# every resume and every compaction. Six resumes in one session paid for it six
# times to learn nothing.
#
# Read with a bounded `timeout`, never a bare `cat`: if the harness leaves the
# pipe open, an unbounded read hangs the whole session start. And skipped
# entirely on a TTY, so running this by hand (as the session-start-hook skill's
# validation step does) does not sit waiting for input.
payload=""
if [[ ! -t 0 ]]; then
  payload="$(timeout 2 cat 2>/dev/null || true)"
fi

# Parsed with bash's own regex rather than node or jq. `source` is a four-value
# enum in machine-written JSON, so there is nothing to escape, and this runs
# BEFORE `npm install` -- reaching for an interpreter here would make the
# verbosity decision depend on the thing the script exists to set up.
source_kind="unknown"
if [[ "${payload}" =~ \"source\"[[:space:]]*:[[:space:]]*\"([a-z]+)\" ]]; then
  source_kind="${BASH_REMATCH[1]}"
fi

# Loud is the default, and `unknown` deliberately lands there: a payload this
# script could not read must not silently choose the quiet path, for the same
# reason a gate that cannot see its input must not print PASS
# (docs/specs/gate-refusal-contract.spec.md).
quiet=0
case "${source_kind}" in
  resume | clear | compact) quiet=1 ;;
esac

# Quiet means "say nothing while it works", never "say nothing when it breaks":
# output is buffered and replayed to stderr on a non-zero exit, so a resume that
# actually fails is as legible as a cold start that does. Without that this
# would trade context for the ability to diagnose, which is the wrong trade.
run() {
  if ((quiet == 0)); then
    "$@"
    return
  fi
  local log status=0
  log="$(mktemp)"
  "$@" >"${log}" 2>&1 || status=$?
  if ((status != 0)); then
    cat "${log}" >&2
  fi
  rm -f "${log}"
  return "${status}"
}

run npm install --no-audit --no-fund
run npm run build

# Wire the git hooks. `.npmrc` sets ignore-scripts=true, which suppresses the
# root `prepare` lifecycle along with every dependency's install script, so
# the `npm install` above never runs husky -- README's setup step says to run
# `npm run prepare` by hand, and this script was the one clone that did not.
# Every web session therefore committed without the pre-commit checks and
# pushed without `ci:local`, silently, because a push with no hook looks
# exactly like a push whose hook passed (barwise-950, barwise-1016).
#
# Then read the result back rather than trusting the exit status: an unset
# core.hooksPath is the failure this block exists to prevent, and it is
# reported loudly rather than as a quiet success. Non-fatal against `set -e`,
# like the tool installs below: a session without hooks can still work, and
# says so; a session that fails to start cannot.
# shellcheck disable=SC2310  # `run` inside `||` is deliberate: see gitleaks below.
run npm run prepare || true
hooks_path="$(git -C "${CLAUDE_PROJECT_DIR}" config --get core.hooksPath || true)"
if [[ "${hooks_path}" != "barwise/.husky/_" ]]; then
  echo "session-start: git hooks NOT wired (core.hooksPath='${hooks_path}')." \
    "Commits skip pre-commit and pushes skip ci:local; run 'npm run prepare' from barwise/." >&2
fi

# The linter behind `npm run check:shell`, one of the 32 gates ci:local
# derives from ci.yml. GitHub's runners ship it and this container does not,
# so without this block the gate REFUSES (exit 2, per
# docs/specs/gate-refusal-contract.spec.md), a web session's pre-push run can
# never be fully green, and the container cannot lint the shell scripts this
# file is one of -- which is how an edit to this hook reaches CI unchecked.
#
# Do not start a comment line with the tool's own bare name: it is read as a
# DIRECTIVE and fails the file with SC1072/SC1073. The first draft of this
# comment did exactly that, and the gate this block installs is what caught
# it.
#
# Non-fatal on purpose, against the `set -e` above: it is a linter, and a
# bootstrap that dies on an apt hiccup costs the whole session rather than
# one gate. A refusal is the correct reading when it is genuinely absent.
if ! command -v shellcheck >/dev/null 2>&1; then
  apt-get install -y --no-install-recommends shellcheck >/dev/null 2>&1 \
    || echo "session-start: shellcheck unavailable; check:shell will refuse (exit 2)." >&2
fi

# The secret scanner behind `npm run check:secrets`, pinned and digest-
# verified by the script (one home for the version, shared with ci.yml).
# Non-fatal for the same reason as the linter above.
# shellcheck disable=SC2310  # `set -e` being disabled inside `run` is the
# point on THIS line and only this one: gitleaks is non-fatal by design (see
# above), so the caller's `||` is what must see the status. `run` tracks its
# own with `status=$?` and returns it, so nothing is swallowed -- and the
# unconditional `run` calls earlier are NOT in an `||`, so there `set -e`
# still aborts the bootstrap as it did before.
run bash "${CLAUDE_PROJECT_DIR}/barwise/scripts/install-gitleaks.sh" \
  || echo "session-start: gitleaks unavailable; check:secrets will refuse (exit 2)." >&2

# A session clone arrives SHALLOW, and `check:secrets` refuses a history
# scan of one rather than reporting a clean bill of health over the few
# commits present -- so without this, one of the 32 gates cannot answer and
# `npm run ci:local` (the pre-push hook) can never be fully green. Deepening
# once costs a few seconds against a 7 MB pack. `--unshallow` errors on an
# already-complete clone, hence the guard.
# Assigned first rather than substituted inside the `if`: a command
# substitution in the condition masks its own exit status (SC2312), and with
# `set -e` a git that fails would otherwise read as "not shallow".
shallow="$(git -C "${CLAUDE_PROJECT_DIR}" rev-parse --is-shallow-repository || echo unknown)"
if [[ "${shallow}" == "true" ]]; then
  git -C "${CLAUDE_PROJECT_DIR}" fetch --unshallow --quiet \
    || echo "session-start: could not unshallow; check:secrets will refuse (exit 2)." >&2
fi

# uv drives optimizer/ (the offline DSPy lane); ~/.local/bin survives in
# the cached container, so the install is skipped on warm starts.
if [[ ! -x "${HOME}/.local/bin/uv" ]]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
# shellcheck disable=SC2016  # the single quotes are the point: this
# writes the literal ${HOME}/${PATH} expansion into the env file, to be
# resolved by the shell that later sources it. Expanding it here would
# bake in this session's paths.
echo 'export PATH="$HOME/.local/bin:$PATH"' >> "${CLAUDE_ENV_FILE}"
