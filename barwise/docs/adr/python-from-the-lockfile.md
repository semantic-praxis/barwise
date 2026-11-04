# Python from the lockfile

Scope: process
Date: 2026-09-26
Tracking: barwise-ubc, barwise-921, barwise-1060, barwise-cpu, barwise-alv,
barwise-c81, barwise-6ef, barwise-en2,
docs/specs/python-lockfile-execution.spec.md,
docs/specs/agent-python-uv-hook.spec.md
Enforced-by: npm run check:python-uv (lockfile-only, no-outside-forms, uv-bootstrap),
tests (project-ancestor), none (barwise-ym8.fq7: lockfile-only),
none (barwise-ym8.l69: no-outside-forms), none (barwise-ym8.q07: project-ancestor),
none (barwise-ym8.usv: groups-and-one-offs), none (barwise-ym8.suc: uv-bootstrap)

## Context

Python runs in barwise in three places: the sqlglot tier of the SQL
bridges in `@barwise/formats` and `@barwise/dbt`, two scripts
(`check-beads.sh` and `compile-runner.sh`), and the DSPy optimizer lane.
A bare `python3` brings the ambient interpreter's site-packages, so two
machines could parse the same SQL with two sqlglot versions and nothing
would record which. This ADR covers the dependency half: which libraries
a run gets. Which interpreter it gets is `docs/adr/pinned-runtimes.md`,
and is out of scope here. The
measurements, including that `uv run --frozen` exits 0 when it finds no
project, and the rejected alternatives are in the two specs above.

## Decision

1. **Every Python execution resolves from `barwise/uv.lock`.**{#lockfile-only} Code,
   scripts and commands use `uv run --frozen [--only-group <g>] ...`.
   CI asserts the lock with `--locked`, so a stale lock fails the build
   rather than being re-resolved. Apart from decision 5, a bare
   `python3`, `python`, `pip` or `pip3` is never used.
2. **No form that resolves outside the lock.**{#no-outside-forms} `--with`,
   `--with-requirements`, `--isolated`, `--no-project`, `uv pip`, `uvx`,
   `uv tool run` and PEP 723 inline script metadata are banned outright.
   `--frozen` and `--locked` do not stop `--with` from installing a
   version the lock does not pin, so these forms cannot be made safe by
   adding a flag.
3. **`pyproject.toml` stays an ancestor of anything that runs Python.**{#project-ancestor}
   uv finds the project by walking up from the working directory, so the
   project sits at `barwise/`, and a call site inside it needs no
   `--project`. One that runs from above `barwise/`, as `check-beads.sh`
   does, passes `--project`. An agent's `uv run` from outside `barwise/`
   is refused unless it passes `--project` naming it.
4. **Optional tiers are dependency groups in the one `pyproject.toml`,
   and a one-off is a run of this project.**{#groups-and-one-offs} sqlglot is the `sqlglot`
   group. A throwaway script goes in the repo and runs `--frozen`.
5. **The one exception is bootstrapping uv itself.**{#uv-bootstrap} CI installs uv with
   `python3 -m pip install uv==<pinned>`.

## Consequences

- `npm run check:python-uv` is a `ci.yml` step with no `if:` guard: it
  runs in every CI run (pushes to main, pull requests into main) that
  reaches it, and like any step is skipped once an earlier step fails.
  It reads tracked `.sh`, `.yml`, `.yaml`, JS/TS and `.py` files and
  fails on the forms in decisions 1 and 2 it can read (gaps below), on a
  `uv run` or `uv sync` with neither `--frozen` nor `--locked`, and on a
  JS/TS file whose uv call has neither flag as a string literal -- a
  check made per file, not per call (barwise-c81). Its one-row allowlist
  (decision 5) fails when stale. The pre-push hook runs it through
  `ci:local` where the git hooks are wired; the session-start hook
  warns when they are not, and nothing gates on it (barwise-1016).
- A `PreToolUse` hook on the Bash tool (`scripts/hooks/python-uv-guard.mjs`)
  refuses an agent's command with the same rules, from the shared
  `scripts/lib/python-uv-rules.mjs`, plus decision 3's `--project` rule.
  It does not inspect other tools' input, quoted text, or heredoc bodies.
- CI's `--locked` comes from one unguarded step, `uv sync --locked
  --only-group sqlglot`. Later CI runs use `--frozen`. In CI the bridge
  tests throw when the sqlglot tier is unavailable, so the tier cannot
  silently drop out there.
- Outside a barwise checkout the sqlglot tier is off and the bridges
  fall back to the regex cascade: with no project uv has no sqlglot,
  and in an unrelated project the undefined `sqlglot` group fails. That
  is deliberate: discovery failing there "is correct"
  (`python-lockfile-execution.spec.md`, "Should we move the Python
  project to `barwise/`? (resolved: yes)"). A foreign project that
  defines a group named `sqlglot` would be used (barwise-en2).
- What each decision lacks:
  - 1: files that execute and are not scanned -- `package.json` scripts,
    `barwise/Makefile` and the `.husky` git hooks (barwise-cpu).
    Nothing checks that CI keeps `--locked`, because the gate accepts
    `--frozen` in a workflow (barwise-alv);
  - 2: the gate's uv argument check matches exact literals, so
    `"--with=..."` passes, and quoted text in `.py` is blanked, so a
    Python `subprocess` call to uv is not read (barwise-c81);
  - 3: checked by the hook for agents and by review (`pr-review`
    checklist, "When Python was touched": "from a cwd under
    `barwise/`"). A tracked script is not checked, by decision: "a
    tracked script's working directory is set by whoever calls it"
    (hook spec, R6);
  - 4: no gate beyond the PEP 723 rule, and the checklist does not
    mention it (barwise-6ef);
  - 5: the allowlist matches any `ci.yml` line containing its text, so a
    second line with the bootstrap prefix would pass (barwise-c81); and
    the session-start hook installs uv unpinned, so the pinned
    bootstrap holds only in CI (barwise-921, its open uv-version
    question).
- A sqlglot test that skips locally, or is disabled with `.skip`, is
  not caught. barwise-921's `audit:skips` (workstream 4) would have
  caught it, and the owner deferred that workstream on 2026-09-06.
- Blind spots accepted in the specs that built the checks: in both, a
  command inside a quoted string, an interpreter held in a variable,
  and a backtick substitution; in the hook alone, a `bash <<EOF` body,
  which the gate still reads once the script is tracked (gate header;
  hook spec, Risks). Other agents' shells and hand-typed commands are
  out of the hook's scope (hook spec, Scope).
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule: `python-lockfile-execution.spec.md` and
  `agent-python-uv-hook.spec.md`; `optimizer/CLAUDE.md`; the `pr-review`
  checklist; `review-tiers.json`; the headers of `check-python-uv.mjs`,
  `python-uv-rules.mjs`, `python-uv-guard.mjs` and `check-beads.sh`;
  the docblocks of both `SqlglotBridge.ts` files; and comments in
  `ci.yml` and `pyproject.toml`.
