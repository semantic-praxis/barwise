#!/usr/bin/env bash
#
# Regenerate the derived showcase artifacts under examples/output/ --
# <model>.verbalizations.txt and <model>.diagnostics.txt -- from each
# committed <model>.orm.yaml.
#
# This delegates to the drift test that guards those files
# (packages/core/tests/integration/exampleOutputDrift.test.ts) run in
# UPDATE_GOLDEN mode, so the regenerator and the guard share one
# derivation and cannot disagree -- the same pattern as
# regen-references.mjs. Two regenerators previously existed with
# different output formats and no guard at all (barwise-870).
#
# The .orm.yaml models themselves are refreshed separately: they come
# from the recorded pipeline fixtures via
# packages/llm/tests/Pipeline.integration.test.ts under UPDATE_GOLDEN=1.
#
# Run: npm run regen:examples
set -euo pipefail
cd "$(dirname "$0")/../packages/core"
UPDATE_GOLDEN=1 npx vitest run tests/integration/exampleOutputDrift.test.ts
