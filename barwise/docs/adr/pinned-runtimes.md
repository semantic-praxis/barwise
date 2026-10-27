# Pinned runtimes

Scope: process
Date: 2026-08-30
Tracking: barwise-ubc, barwise-915, barwise-1059, barwise-920, barwise-g32,
barwise-8hs, barwise-1045, barwise-921,
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
Python run the code. Which Python libraries a run gets is
`docs/adr/python-from-the-lockfile.md`, and is out of scope here. The
rule entered the root `CLAUDE.md` on 2026-08-30; the web-session hook
that applies decisions 1 and 3 there came on 2026-09-25
(`session-node-pin.spec.md`). A check that each runtime has one
declared authority is proposed, not built: workstream 4 of
`deterministic-guards.spec.md`, still marked provisional.

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
  `tracker-conflicts`) set Node with `node-version-file: .nvmrc`, and
  none names a literal version. In `copilot-review` the step runs under
  `if: steps.decide.outputs.need == 'true'`, inside a job that runs only
  on `workflow_dispatch` while the request is paused (barwise-ilb). In
  `ci`, the docs-only classifier (`node scripts/lib/changed-class.mjs`)
  runs before Node is set up, on the runner image's own Node.
- In web sessions only (`CLAUDE_CODE_REMOTE=true`), the session-start
  hook installs the `.nvmrc` Node through nvm, reads `node --version`
  back, and on a mismatch warns and installs with `npm ci` so the
  lockfile is untouched. `session-start.test.mjs` covers the five cases
  the spec lists. A session that cannot get the pin starts anyway and
  says so, as decided in `session-node-pin.spec.md`, "Should a failed
  Node install stop the session? (resolved: no, and it installs with
  `npm ci`)". On a developer machine no repo tooling checks the Node
  version; a version manager that reads `.nvmrc` may, and npm warns
  below the `engines.node` major.
- The Python pin is only partly in effect. CI's `uv python install`,
  run in `barwise/`, reads the repo-root `.python-version` and
  installs 3.13. But uv's selection for `find`, `sync` and `run` looks
  for a version file only up to the project root at `barwise/`, and
  falls back to `requires-python = ">=3.13"`. Where nothing installs the
  pinned minor first -- a developer machine, a web session -- the
  interpreter floats within the floor (barwise-g32). Measured with uv
  0.11.32; CI's uv 0.12.7 was not measured.
- What each decision lacks:
  - 1: `README.md` "Prerequisites" restates the version ("currently
    26.7.0") with nothing checking it (barwise-8hs). Nothing checks
    `.nvmrc` against `engines.node`, which `check:parity` pairs only
    with the lockfile's copy; nothing stops a workflow from naming a
    literal version; CI's classifier runs on an unpinned Node; and the
    runner image is `ubuntu-latest` (barwise-920, a proposed
    `check:pins`, not built);
  - 2: see the gap above. Nothing checks that `uv.lock` stays a single
    resolution (barwise-g32);
  - 3: no gate checks the running version against the pin; the
    web-session hook reads Node back, and measurement tools
    (`measure-comparison.mjs`, `fault-matrix.mjs`) record it.
    `ci:local`, which the pre-push hook runs, and the pre-commit hook do
    not check it (barwise-1045). Whether `test:coverage` should refuse on
    another major is left open: `gate-refusal-contract.spec.md`, Open
    decisions, only recommends it. Nothing reads back the Python version
    that ran (barwise-920; barwise-915's close note carries it there).
- uv itself is pinned only in CI (0.12.7, "a version input like any
  other"). The web-session hook installs the latest release. Whether to
  pin it locally is an open question recorded on barwise-921.
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), `README.md`, `GETTING_STARTED.md`,
  `steward` section 4, `session-start.sh` and `ci.yml` comments also
  state this rule. `session-node-pin.spec.md` points
  here from its resolved heading.
