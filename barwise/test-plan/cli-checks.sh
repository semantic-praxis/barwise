#!/usr/bin/env bash
#
# Real-use shakedown for the `barwise` CLI. Exercises every command against
# the shipped examples plus the fixtures in ./fixtures, asserting exit codes
# and key output. This is a bug-hunting harness, not a substitute for the
# unit/integration suites -- it drives the built bundle the way a user would.
#
# Usage:
#   test-plan/cli-checks.sh
#
# Environment:
#   BARWISE   Override the CLI invocation (default: node <repo>/packages/cli/
#             dist/bundle/index.cjs). E.g. BARWISE="barwise" to test an
#             installed binary, or BARWISE="node packages/cli/dist/index.js".
#   ANTHROPIC_API_KEY   If set, the transcript-import checks run (they call an
#             LLM). If unset, those checks are skipped, not failed.
#
# Exit code: 0 if every check passed, 1 if any failed, 2 on setup error.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "$SCRIPT_DIR")"
FIX="$SCRIPT_DIR/fixtures"
EX="$ROOT/examples"
cd "$ROOT" || exit 2

BUNDLE="$ROOT/packages/cli/dist/bundle/index.cjs"
BARWISE="${BARWISE:-node $BUNDLE}"

if [ -z "${BARWISE+x}" ] || { [ "$BARWISE" = "node $BUNDLE" ] && [ ! -f "$BUNDLE" ]; }; then
  echo "CLI bundle not found at $BUNDLE."
  echo "Build it first:  npm run build && npm run --workspace=@barwise/cli bundle"
  echo "Or point BARWISE at another invocation (e.g. BARWISE=barwise)."
  exit 2
fi

PASS=0
FAIL=0
SKIP=0
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Colors only when stdout is a TTY.
if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; N=$'\033[0m'
else G=""; R=""; Y=""; D=""; N=""; fi

# run <desc> -- <cmd...>   captures combined output in $OUT and exit in $RC.
run() {
  DESC="$1"; shift; [ "$1" = "--" ] && shift
  OUT="$("$@" 2>&1)"; RC=$?
}
ok()   { PASS=$((PASS + 1)); printf "  ${G}PASS${N} %s\n" "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf "  ${R}FAIL${N} %s\n     ${D}%s${N}\n" "$1" "$2"; }
skip() { SKIP=$((SKIP + 1)); printf "  ${Y}SKIP${N} %s\n     ${D}%s${N}\n" "$1" "$2"; }

# assert_exit <desc> <expected-rc>
assert_exit() {
  if [ "$RC" = "$2" ]; then ok "$1"; else bad "$1" "expected exit $2, got $RC: ${OUT%%$'\n'*}"; fi
}
# assert_ok_contains <desc> <needle>   (exit 0 AND output contains needle)
assert_ok_contains() {
  if [ "$RC" != 0 ]; then bad "$1" "exit $RC: ${OUT%%$'\n'*}"
  elif printf '%s' "$OUT" | grep -qiF -- "$2"; then ok "$1"
  else bad "$1" "missing '$2' in output"; fi
}
# assert_contains <desc> <needle>   (output contains needle, any exit)
assert_contains() {
  if printf '%s' "$OUT" | grep -qiF -- "$2"; then ok "$1"
  else bad "$1" "missing '$2' in output"; fi
}

section() { printf "\n${D}== %s ==${N}\n" "$1"; }

CLEAN="$EX/transcripts/clinic-appointments.orm.yaml"
SHOWCASE="$FIX/constraints-showcase.orm.yaml"
EU_OK="$FIX/external-uniqueness.orm.yaml"
EU_BAD="$FIX/external-uniqueness-violation.orm.yaml"
BROKEN="$FIX/broken.orm.yaml"

section "Smoke"
run "version" -- $BARWISE --version;        assert_exit "barwise --version" 0
run "help"    -- $BARWISE --help;            assert_ok_contains "barwise --help lists commands" "validate"

section "Validate"
run "v-clean" -- $BARWISE validate "$CLEAN";          assert_ok_contains "validate clean model -> 0 errors" "0 error"
run "v-json"  -- $BARWISE validate "$CLEAN" --format json
if [ "$RC" = 0 ] && printf '%s' "$OUT" | node -e 'JSON.parse(require("fs").readFileSync(0,"utf8"))' 2>/dev/null; then
  ok "validate --format json emits valid JSON"
else
  bad "validate --format json emits valid JSON" "not parseable JSON (rc=$RC): ${OUT%%$'\n'*}"
fi
run "v-broken" -- $BARWISE validate "$BROKEN";        assert_exit "validate broken model exits 1" 1

section "Verbalize"
run "verb" -- $BARWISE verbalize "$CLEAN";   assert_exit "verbalize clean model" 0
run "ce"   -- $BARWISE verbalize "$SHOWCASE" --counterexamples
assert_ok_contains "verbalize --counterexamples emits probes" "Rules out:"

section "Query (incl. anchors)"
for q in entities fact-types constraints stats anchors; do
  run "q-$q" -- $BARWISE query "$CLEAN" "$q"; assert_exit "query $q" 0
done
run "q-anchors-content" -- $BARWISE query "$CLEAN" anchors
assert_ok_contains "query anchors names an anchor" "Reference mode"

section "Export (ddl, openapi, avro, dbt)"
for f in ddl openapi avro dbt; do
  run "x-$f" -- $BARWISE export "$CLEAN" --format "$f"; assert_exit "export --format $f" 0
done

section "Diagram"
run "diag" -- $BARWISE diagram "$CLEAN"; assert_ok_contains "diagram emits SVG" "<svg"

section "Describe"
run "desc" -- $BARWISE describe "$CLEAN"; assert_exit "describe" 0

section "Diff"
run "diff" -- $BARWISE diff \
  "$ROOT/packages/cli/tests/fixtures/simple.orm.yaml" \
  "$ROOT/packages/cli/tests/fixtures/simple-modified.orm.yaml"
assert_exit "diff two models" 0

section "External uniqueness (WS4c)"
run "eu-ok"  -- $BARWISE validate "$EU_OK";  assert_ok_contains "clean combination -> 0 errors" "0 error"
run "eu-bad" -- $BARWISE validate "$EU_BAD"
assert_contains "shared combination -> violation" "External uniqueness constraint is violated"
run "eu-bad-rc" -- $BARWISE validate "$EU_BAD"; assert_exit "violation exits 1" 1
run "eu-ce" -- $BARWISE verbalize "$EU_OK" --counterexamples
assert_ok_contains "external-uniqueness counterexample present" "identifying combination"

section "Project (split -> validate manifest)"
if [ -f "$ROOT/docs/auction.orm.yaml" ] && [ -f "$EX/auction-split.yaml" ]; then
  run "split" -- $BARWISE project split "$ROOT/docs/auction.orm.yaml" \
    --config "$EX/auction-split.yaml" --out "$TMP/proj"
  assert_exit "project split" 0
  run "split-validate" -- $BARWISE validate "$TMP/proj/project.orm-project.yaml"
  assert_ok_contains "split project validates (0 errors)" "0 error"
else
  skip "project split" "docs/auction.orm.yaml or examples/auction-split.yaml not found"
fi

section "Transcript import (LLM -- needs ANTHROPIC_API_KEY)"
TRANSCRIPT="$EX/transcripts/library-system.md"
if [ -n "${ANTHROPIC_API_KEY:-}" ] && [ -f "$TRANSCRIPT" ]; then
  OUTYAML="$TMP/library.orm.yaml"
  run "import" -- $BARWISE import transcript "$TRANSCRIPT" \
    --output "$OUTYAML" --alternatives --trail
  assert_exit "import transcript --alternatives --trail" 0
  if [ -f "$OUTYAML" ]; then ok "model written"; else bad "model written" "missing $OUTYAML"; fi
  if [ -f "$TMP/library.trail.json" ]; then ok "reasoning-trail sidecar written"
  else bad "reasoning-trail sidecar written" "missing $TMP/library.trail.json"; fi
  if [ -f "$OUTYAML" ]; then
    run "import-validate" -- $BARWISE validate "$OUTYAML"
    assert_exit "imported model validates (load + parse)" 0
  fi
else
  skip "transcript import" "ANTHROPIC_API_KEY unset or transcript missing"
fi

printf "\n${D}----------------------------------------${N}\n"
printf "Passed: ${G}%d${N}   Failed: ${R}%d${N}   Skipped: ${Y}%d${N}\n" "$PASS" "$FAIL" "$SKIP"
[ "$FAIL" -eq 0 ]
