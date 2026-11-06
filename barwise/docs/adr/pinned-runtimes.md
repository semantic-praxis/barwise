# Pinned runtimes

Scope: process
Date: 2026-08-30
Tracking: barwise-ubc, barwise-915, barwise-1059, barwise-920, barwise-g32,
barwise-8hs, barwise-1045, barwise-921,
docs/specs/session-node-pin.spec.md,
docs/specs/deterministic-guards.spec.md
Enforced-by: npm run check:pins (node-from-nvmrc, python-minor, verify-running),
none (barwise-ym8.q89: node-from-nvmrc)

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
   home.**{#node-from-nvmrc} CI workflows read it with `node-version-file`, and the
   web-session hook reads it rather than copying the number.
2. **Python is pinned in `.python-version`, beside `.nvmrc`, to the minor
   only.**{#python-minor} The patch is left out because uv did not enforce one: with
   `3.13.12` in the file, uv 0.8.17 used 3.13.7 and exited 0
   (barwise-915).
3. **Verify the interpreter that ran, never the file that asked.**{#verify-running} A
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
- `npm run check:pins` (`docs/specs/runtime-pins-check.spec.md`) is a
  `ci.yml` step with no `if:`, after the Python toolchain step, and the
  pre-push hook runs it through `ci:local`. It fails when a workflow's
  `setup-node` names a version or does not read `.nvmrc`, when the
  session hook stops reading `.nvmrc`, and when a `.python-version` is
  missing at the root or beside `pyproject.toml` or names more than a
  minor. It refuses (exit 2) when the Node running it is another major
  than `.nvmrc`, or the Python `uv python find` resolves for the project
  is another minor than the pin, or uv is absent; it prints the exact
  versions on every run. A Node patch that differs is printed, not
  refused. On a machine without uv it refuses, so `fault-matrix` reads it
  UNREADABLE there.
- uv reads `.python-version` only from the project directory (`uv python
  install` also reads the root one; `find`, `run` and `sync` do not;
  measured with uv 0.11.32). So `barwise/.python-version` is a copy of
  the root pin beside `pyproject.toml`, held equal by `check:parity`
  (the `python-version` set), and the interpreter no longer floats within
  `requires-python = ">=3.13"` outside CI (barwise-g32).
- What each decision lacks:
  - 1: CI's docs-only classifier runs before `setup-node`, on the runner
    image's own Node, and the runner image is `ubuntu-latest`
    (barwise-ym8.q89; pinning the image is the spec's open decision 1).
    `engines.node` is a floor, not a copy of the pin, and is not
    compared with it. `README.md` names `.nvmrc` without restating its
    number (barwise-8hs);
  - 2: nothing checks that `uv.lock` stays a single resolution
    (barwise-g32);
  - 3: `check:pins` reads back both runtimes in CI and at pre-push; the
    pre-commit hook does not run it. Whether a Node patch should be
    refused is the spec's open decision 2.
- uv itself is pinned only in CI (0.12.7, "a version input like any
  other"). The web-session hook installs the latest release. Whether to
  pin it locally is an open question recorded on barwise-921.
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), `README.md`, `GETTING_STARTED.md`,
  `steward` section 4, `session-start.sh` and `ci.yml` comments also
  state this rule. `session-node-pin.spec.md` points
  here from its resolved heading.
