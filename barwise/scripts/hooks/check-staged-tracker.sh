#!/bin/sh
# Validate the STAGED tracker when this commit changes it. Called from
# barwise/ by .husky/pre-commit and .husky/pre-merge-commit, which pin
# GIT_WORK_TREE first in a linked worktree (barwise-hud).
#
# Two hooks because git runs exactly one of them per commit: pre-commit for
# an ordinary commit and for a conflicted merge concluded with `git
# commit`; pre-merge-commit, not pre-commit, for the commit a clean merge
# makes. Before the second hook a merged tracker reached history unchecked
# until CI -- and the merge driver cannot see a dependency on an issue the
# other side deleted, so this is where that is caught
# (docs/specs/beads-merge-driver.spec.md).
#
# The index copy, not the working-tree file: a broken tracker that was
# staged and then fixed on disk without restaging would otherwise pass here
# and be committed broken. Paths from `git diff` are repo-root-relative.
git diff --cached --name-only | grep -qx '.beads/issues.jsonl' || exit 0

echo "validating staged .beads/issues.jsonl ..."
tmp="$(mktemp)"
trap 'rm -f "${tmp}"' EXIT
# Exit 2 is "could not answer" (docs/specs/gate-refusal-contract.spec.md):
# no uv, an unreadable file. It still stops the commit, but says so rather
# than calling the file invalid.
if ! git show :.beads/issues.jsonl >"${tmp}"; then
  echo "could not read the staged .beads/issues.jsonl" >&2
  exit 2
fi
bash scripts/check-beads.sh --strict "${tmp}"
status=$?
if [ "${status}" -eq 2 ]; then
  echo "could not validate the staged .beads/issues.jsonl (see above); nothing was judged." >&2
  exit 2
fi
if [ "${status}" -ne 0 ]; then
  echo "the staged .beads/issues.jsonl failed validation (see above)." >&2
  echo "  Fix the errors and stage the file again." >&2
  exit 1
fi
