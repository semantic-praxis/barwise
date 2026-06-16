#!/usr/bin/env bash
#
# Regenerate the showcase outputs under examples/output/ from each model
# there, using the built barwise CLI. The models were extracted from the
# sample transcripts; these outputs are committed comparison artifacts, so
# regenerating them across barwise versions shows how verbalization and
# validation change. Each file is stamped with the barwise version to make
# version-to-version diffs explicit.
#
# For each examples/output/<model>.orm.yaml it writes:
#   <model>.verbalizations.txt   (barwise verbalize)
#   <model>.diagnostics.txt      (barwise validate)
#
# Run after a build:  npm run build && npm run regen:examples
# Paths are repo-relative so the output is machine-independent.
set -uo pipefail
shopt -s globstar nullglob

cd "$(dirname "$0")/.."

CLI="packages/cli/dist/index.js"
if [[ ! -f "$CLI" ]]; then
  echo "error: $CLI not found; run 'npm run build' first" >&2
  exit 1
fi

VER="$(node -p "require('./package.json').version")"

models=(examples/output/*.orm.yaml)
if [[ ${#models[@]} -eq 0 ]]; then
  echo "error: no models found under examples/output/" >&2
  exit 1
fi

for m in "${models[@]}"; do
  base="${m%.orm.yaml}"
  echo "==> regenerating $(basename "$base")"
  {
    echo "# barwise $VER -- verbalize"
    echo
    node "$CLI" verbalize "$m"
  } >"$base.verbalizations.txt"
  # validate exits non-zero when a model has errors; capture its output
  # regardless so the diagnostics file is always written.
  {
    echo "# barwise $VER -- validate"
    echo
    node "$CLI" validate "$m" || true
  } >"$base.diagnostics.txt"
done

echo "done"
