#!/bin/bash
set -euo pipefail

# Web-session bootstrap: install the monorepo dependencies and the uv
# toolchain for the prompt-optimization lane. Local environments manage
# their own setup.
if [[ "${CLAUDE_CODE_REMOTE:-}" != "true" ]]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR}/barwise"

npm install --no-audit --no-fund
npm run build

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
bash "${CLAUDE_PROJECT_DIR}/barwise/scripts/install-gitleaks.sh" \
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
