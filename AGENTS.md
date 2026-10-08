# Agent Instructions

Issue tracking uses beads, through `node barwise/scripts/beads-crud.mjs`.
The interface, its rules and the session-completion steps live once, in
the root `CLAUDE.md` ("Beads Issue Tracker" and "Session Completion").
A `bd init` generated block used to sit here and prescribed `bd`
commands (`bd prime`, `bd remember`) that CLAUDE.md says not to rely
on, so two files gave an agent opposite instructions (barwise-a49). Do
not run `bd init` in this repository: it writes that block back.

## Git Workflow

Never commit directly to main. Always create a feature branch and
open a pull request.

## GitHub CLI

Always run `gh auth switch --user gabeschenz` before using the `gh`
command. This ensures the correct GitHub account is active for
authentication.
