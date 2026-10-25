# Pinned runtimes

Scope: process
Date: 2026-09-25
Tracking: barwise-ubc, barwise-915, barwise-1059, barwise-920, barwise-g32,
barwise-8hs,
docs/specs/session-node-pin.spec.md,
docs/specs/deterministic-guards.spec.md

## Context

The same commit gave different results on different runtimes. V8 leaves
functions it never compiled out of its coverage report, so
`@barwise/code-analysis` read 95% functions on Node 22 and 81% on Node
26 from identical source (root `CLAUDE.md`; the `ci.yml` comment on the
Node version). `uv.lock` branched on `python_full_version`, so
`uv sync --frozen` installed numpy 2.4.6 locally and 2.5.2 in CI
(barwise-915). This ADR covers the interpreter half: which Node and which
Python run the code. Which Python libraries a run gets is the lockfile
rule in the root `CLAUDE.md` conventions, and is out of scope here. The
web-session design is in `session-node-pin.spec.md`; the planned check
that each runtime has one declared authority is workstream 4 of
`deterministic-guards.spec.md`.

## Decision

1. **Node is the version `.nvmrc` names, and that file is its one
   home.** CI workflows read it with `node-version-file`, and the
   web-session hook reads it rather than copying the number.
2. **Python is pinned in `.python-version`, beside `.nvmrc`, to the minor
   only.** The patch is left out because uv did not enforce one: with
   `3.13.12` in the file, uv 0.8.17 used 3.13.7 and exited 0
   (barwise-915).
3. **Verify the interpreter that ran, never the file that asked.** A
   claim that a run used the pinned runtime rests on reading the running
   version back.

## Consequences

- All four workflows (`ci`, `release`, `copilot-review`,
  `tracker-conflicts`) set Node with `node-version-file: .nvmrc`. The
  step is unguarded except in `copilot-review`, where it runs under
  `if: steps.decide.outputs.need == 'true'`, the same guard as the Node
  work it serves. No workflow names a literal version.
- In web sessions only (`CLAUDE_CODE_REMOTE=true`), the session-start
  hook installs the `.nvmrc` Node through nvm, reads `node --version`
  back, and on a mismatch warns and installs with `npm ci` so the
  lockfile is untouched. `session-start.test.mjs` covers the five cases
  the spec lists. A session that cannot get the pin starts anyway and
  says so, as decided in `session-node-pin.spec.md`, "Should a failed
  Node install stop the session? (resolved: no, and it installs with
  `npm ci`)". On a developer machine nothing reads `.nvmrc` but `nvm use`.
- The Python pin is not in effect where Python runs. Every uv call runs
  in the project at `barwise/`, and uv looks for a version file only up
  to the project root, so it never reads the repo-root `.python-version`.
  It selects from `requires-python = ">=3.13"` instead. Measured with uv
  0.11.32 (`uv python find -v` from `barwise/`); CI's uv 0.12.7 was not
  measured (barwise-g32).
- What each decision lacks:
  - 1: `README.md` "Prerequisites" restates the version ("currently
    26.7.0") with nothing checking it (barwise-8hs). Nothing checks
    `.nvmrc` against `engines.node`, which `check:parity` pairs only
    with the lockfile's copy; nothing stops a workflow from naming a
    literal version; and the runner image is `ubuntu-latest`
    (barwise-920, `check:pins`);
  - 2: see the break above. Nothing checks that `uv.lock` stays a
    single resolution (barwise-g32);
  - 3: only the web-session hook reads a runtime back. `ci:local`, which
    the pre-push hook runs, and the pre-commit hook do not check the Node
    version (barwise-1045). Whether `test:coverage` should refuse on
    another major is left open: `gate-refusal-contract.spec.md`, Open
    decisions, only recommends it. Nothing reads back the Python version
    that ran (barwise-920; barwise-915's close note carries it there).
- uv itself is pinned only in CI (0.12.7, "a version input like any
  other"). The web-session hook installs the latest release. Whether to
  pin it locally is an open question recorded on barwise-921.
- Until architecture-index WS5 replaces them with links, the root
  `CLAUDE.md` "Monorepo Commands", `README.md`, `GETTING_STARTED.md`,
  `steward` section 4, `session-start.sh` and `ci.yml` comments also
  state this rule (barwise-ubc, WS5). `session-node-pin.spec.md` points
  here from its resolved heading.
