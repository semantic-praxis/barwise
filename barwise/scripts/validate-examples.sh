#!/usr/bin/env bash
#
# Validate every example model and project under examples/ with the
# built barwise CLI. Spawning the CLI as a child process also smoke-tests
# that the built binary runs end to end (REPO_REVIEW findings T3 and T2).
#
# Warnings do not fail the run -- the CLI only sets a non-zero exit code
# when a model has validation errors.
set -uo pipefail
shopt -s globstar nullglob

cd "$(dirname "$0")/.."

CLI="packages/cli/dist/index.js"
if [[ ! -f "$CLI" ]]; then
  echo "error: $CLI not found; run 'npm run build' first" >&2
  exit 1
fi

# Project manifests validate their domains together (cross-domain
# references resolve only in project context), so the domain files they
# own are not validated standalone.
projects=(examples/**/*.orm-project.yaml)

# Standalone models live outside the project directories.
models=(examples/models/*.orm.yaml examples/transcripts/*.orm.yaml)

targets=("${projects[@]}" "${models[@]}")
if [[ ${#targets[@]} -eq 0 ]]; then
  echo "error: no example models or projects found under examples/" >&2
  exit 1
fi

status=0
for f in "${targets[@]}"; do
  echo "==> validating $f"
  if ! node "$CLI" validate "$f"; then
    status=1
  fi
done

if [[ $status -ne 0 ]]; then
  echo "" >&2
  echo "error: one or more examples failed validation" >&2
fi
exit $status
