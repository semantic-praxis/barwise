# at-root.mjs forwards arguments the same way whichever spelling the caller uses

Status: Implemented -- workstream 1 (PR #613)

Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-2lz (this spec); barwise-907 (why the wrapper exists)

## Principle

`at-root.mjs` exists so that one spelling of a monorepo command works
from any directory (barwise-907). Its forwarding contract was never
written down, and it had a hole: the wrapper adds its own `--` before
the caller's arguments, so a caller who also typed `--` passed a literal
`--` through to the script. That is the case "define errors out of
existence" is about. The mistake was easy to make, because callers copy
the npm spelling, and expensive when made: `audit-corrections` read the
stray `--` as its mode, ran in survey mode, wrote nothing and exited 0.
The fix belongs in the one place every script is reached through, not in
each script.

## Scope

In scope:

- When `at-root.mjs <script>` is called with arguments, the script shall
  receive them after a single `--`, so npm does not read them as its own
  options.
- When the caller's first argument is `--`, the wrapper shall drop it
  before forwarding, so `at-root.mjs x -- --flag` and
  `at-root.mjs x --flag` reach the script identically.
- When `--` appears later in the arguments, the wrapper shall forward it
  unchanged.
- When no script is named, or the first argument is `--help` or `-h`,
  the wrapper shall print usage and exit 2. Otherwise its exit code is
  the script's own. (Existing behavior, recorded here.)

Out of scope:

- Scripts that read flags positionally (`audit-corrections.mjs`).
  Hardening each one was the alternative the owner did not choose; a
  direct `npm run x -- -- --flag` still reaches them with a stray `--`.

## Alternatives considered

- **Every reachable script reads flags with `includes()`.** This also
  protects direct `npm run` callers, but it touches every script, and a
  new script written positionally reopens the hole. The owner chose the
  wrapper fix (barwise-2lz notes, 2026-10-08).
- **Both.** Rejected for now as more change than the defect needs; the
  wrapper is the documented spelling (root `CLAUDE.md`, "Monorepo
  Commands").

## Workstreams

### 1. Strip one leading `--` in the wrapper (implemented, PR #613)

`barwise/scripts/at-root.mjs` drops a leading `--` from the caller's
arguments. `barwise/scripts/tests/at-root.test.mjs` runs a sandbox copy
of the wrapper beside a stub `package.json` whose script prints its
argv, and asserts that `--write` and `-- --write` both arrive as
`["--write"]`, that a later `--` is kept, and that no arguments arrive as
`[]`. Mutation check: removing the strip is caught by that test.

## Risks and testing

- The one behavior given up is passing a literal leading `--` to a
  script through the wrapper. None of the documented invocations in the
  instruction files pass one.
- The existing at-root tests (usage exit 2, unknown script fails, same
  result from three working directories) still pass unchanged.

## Non-goals

- No change to how npm itself forwards arguments, and no change to any
  script.
