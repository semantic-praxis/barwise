#!/bin/sh
# Scan what is about to be committed for credentials. Called from barwise/
# by .husky/pre-commit, which pins GIT_WORK_TREE first in a linked
# worktree (barwise-hud).
#
# The exit status passes through, and the message follows it. A refusal
# (2: gitleaks absent, its config absent, the root unresolvable) is not a
# found credential: the hook used to read every non-zero status as
# "credential-shaped content" and tell the author to rotate a key that
# never leaked (barwise-jha; docs/adr/gate-refusal-contract.md,
# readers-keep-third). Both block the commit.
npm run --silent check:secrets -- --staged
status=$?
if [ "${status}" -eq 0 ]; then
  exit 0
fi
if [ "${status}" -eq 1 ]; then
  echo "pre-commit: credential-shaped content in the tree (see above)." >&2
  echo "  If it is a real key, ROTATE it -- amending the commit does not un-leak it." >&2
  exit 1
fi
echo "pre-commit: check:secrets could not answer (exit ${status}, see above), so nothing" >&2
echo "  was scanned. This is not a found credential; fix what it names and commit again." >&2
exit "${status}"
