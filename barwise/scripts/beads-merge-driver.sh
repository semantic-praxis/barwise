#!/bin/sh
# The command git runs to merge .beads/issues.jsonl, installed as
# <git-common-dir>/barwise-merge/driver.sh by install-merge-driver.mjs
# (docs/specs/beads-merge-driver.spec.md). Arguments: %O %A %B %P.
#
# A wrapper rather than registering node directly, because git treats any
# non-zero driver exit as a conflict and keeps whatever is in %A. When the
# driver crashes or cannot start, %A is still the current side, unmarked,
# and a `git add` silently drops every issue the other side added. So only
# the driver's own two answers pass through; every other outcome becomes
# git's marked line merge, which check-beads.sh rejects until resolved.
node "$(dirname "$0")/beads-merge-driver.mjs" "$@"
status=$?
case "${status}" in
  0) exit 0 ;;
  3) exit 1 ;;
  *) ;;
esac
echo "beads merge driver: exit ${status}; falling back to git's line merge for ${4:-.beads/issues.jsonl}." >&2
git merge-file -L current -L base -L other "$2" "$1" "$3"
if [ "$?" -gt 127 ]; then
  # merge-file itself failed (it exits negative, read as 255) and may have
  # written nothing. Mark the whole file, so the current side can never be
  # left alone and unmarked.
  tmp="$2.barwise-merge.$"
  {
    echo "<<<<<<< current"
    cat "$2"
    echo "======="
    cat "$3"
    echo ">>>>>>> other"
  } >"${tmp}" 2>/dev/null
  mv "${tmp}" "$2"
fi
# 1 even when the line merge came out clean: the driver did not decide this
# merge, so git should stop for a person to look.
exit 1
