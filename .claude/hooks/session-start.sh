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
