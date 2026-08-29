#! /usr/bin/env bash

set -euo pipefail

STAMP="$(date '+%Y%m%d-%H%M')"
STAMP="20260828-1647"

mkdir -p "eval-payloads/$STAMP"

# The two shipped variants
npx barwise prompt eval --provider anthropic --model claude-haiku-4-5 \
  --split dev --repeat 5 --concurrency 3 --verbose \
  --save-payloads "eval-payloads/$STAMP/haiku45-2-dev" 2>&1 | tee "eval-payloads/$STAMP/haiku45-2-dev.log"

npx barwise prompt eval --provider anthropic --model claude-haiku-4-5 \
  --split train --repeat 5 --concurrency 7 --verbose \
  --save-payloads "eval-payloads/$STAMP/haiku45-2-train" 2>&1 | tee "eval-payloads/$STAMP/haiku45-2-train.log"

npx barwise prompt eval --provider anthropic --model claude-sonnet-5 \
  --split dev --repeat 5 --concurrency 3 --verbose \
  --save-payloads "eval-payloads/$STAMP/sonnet5-3-dev" 2>&1 | tee "eval-payloads/$STAMP/sonnet5-3-dev.log"
npx barwise prompt eval --provider anthropic --model claude-sonnet-5 \
  --split train --repeat 5 --concurrency 7 --verbose \
  --save-payloads "eval-payloads/$STAMP/sonnet5-3-train" 2>&1 | tee "eval-payloads/$STAMP/sonnet5-3-train.log"

# The default artifact, one control per model
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-haiku-4-5 \
  --split dev --repeat 5 --concurrency 3 --verbose \
  --save-payloads "eval-payloads/$STAMP/default-haiku-dev" 2>&1 | tee "eval-payloads/$STAMP/default-haiku-dev.log"
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-haiku-4-5 \
  --split train --repeat 5 --concurrency 7 --verbose \
  --save-payloads "eval-payloads/$STAMP/default-haiku-train" 2>&1 | tee "eval-payloads/$STAMP/default-haiku-train.log"

npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-sonnet-5 \
  --split dev --repeat 5 --concurrency 3 --verbose \
  --save-payloads "eval-payloads/$STAMP/default-sonnet-dev" 2>&1 | tee "eval-payloads/$STAMP/default-sonnet-dev.log"
npx barwise prompt eval --artifact-version default \
  --provider anthropic --model claude-sonnet-5 \
  --split train --repeat 5 --concurrency 7 --verbose \
  --save-payloads "eval-payloads/$STAMP/default-sonnet-train" 2>&1 | tee "eval-payloads/$STAMP/default-sonnet-train.log"

git checkout -b "eval-round-$STAMP"
git add -f "eval-payloads/$STAMP" packages/promptlab/evals/history.jsonl
git commit -m "log: eval round $STAMP"
git push
