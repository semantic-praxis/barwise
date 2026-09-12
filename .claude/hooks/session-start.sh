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
