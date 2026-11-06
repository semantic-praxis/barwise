# check:python-uv, widened to the rest of the ADR

Status: Draft 2026-11-06; no workstream implemented
Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 3), barwise-ym8.fq7,
barwise-ym8.l69, barwise-ym8.q07, barwise-ym8.usv, barwise-ym8.suc
Touches: barwise/scripts/check-python-uv.mjs, barwise/scripts/lib/python-uv-rules.mjs,
barwise/scripts/hooks/python-uv-guard.mjs, barwise/scripts/tests/,
.claude/hooks/session-start.sh, barwise/docs/adr/python-from-the-lockfile.md,
barwise/docs/adr/probes.json, barwise/docs/ARCHITECTURE.md

## Principle

`docs/adr/python-from-the-lockfile.md` states five decisions, and
`check:python-uv` holds part of each. The gap issues name where a
violation passes today: a uv call written with a global option before its
subcommand, a file the gate does not read, `-w` for `--with`, a second
Python manifest, and a uv bootstrap that is not the pinned one. Each is
literal text, which is what makes this gate possible at all (its header:
"every required and banned form above is literal text in a command"). So
the work is widening what text the gate reads and how it reads a uv call,
not a new instrument.

## The reading this spec starts from (main at 299a28b3)

- `check:python-uv` reads tracked `.sh`, `.yml`, `.yaml`, `.ts`, `.tsx`,
  `.js`, `.mjs`, `.cjs` and `.py` files, minus itself, its rules, the
  agent hook, their tests and `.beads/hooks/`. It does not read
  `package.json` scripts, `barwise/Makefile`, or the git hooks under
  `barwise/.husky/`, which have no extension.
- `uvFindings` matches `uv run` and `uv sync` literally, so `uv --quiet
  run python -V` and `uv --directory barwise run ...` are not seen as runs
  at all, and their flags are never checked.
- `BANNED_UV_FLAGS` matches by substring, which catches `--with=x` on a
  shell line but not `-w x`. In a JS args array the check is set
  membership of whole string literals, so `"--with=sqlglot"` passes.
- A `.py` file is scanned for PEP 723 metadata and for a bare interpreter
  in a subprocess call, not for a uv call's flags.
- Nothing checks that `barwise/pyproject.toml` is the only Python
  manifest. Today it is (the tracked tree holds no other `pyproject.toml`,
  `requirements*.txt`, `setup.py`, `setup.cfg` or `Pipfile`).
- The bootstrap allowlist matches a substring of a line, so a command
  chained after `python3 -m pip install --quiet uv==...` on the same line
  is exempt with it. `.claude/hooks/session-start.sh` installs uv with an
  unpinned `curl -LsSf https://astral.sh/uv/install.sh | sh`, while CI
  pins `uv==<version>`: a live break of decision 5.
- CI asserts the lock in its own step (`uv sync --locked --only-group
  sqlglot`); `npm run test:optimizer`, shared by local runs and CI, uses
  `--frozen`. Decision 1's "CI asserts the lock with `--locked`" is met by
  that step, not by every call.

## Scope

In scope, one workstream per gap issue:

1. **A uv call is parsed, not matched** (fq7, l69). One function reads a
   command into uv's global options, its subcommand and the subcommand's
   arguments, so `uv --quiet run`, `uv --directory x sync` and `uv -q
   run` are runs. Flags are checked on the parsed arguments, with
   aliases (`-w` for `--with`) and `=` forms, in shell lines, JS args
   arrays (a literal that starts with a banned flag) and `.py`
   subprocess lists. Both the gate and the agent hook use it.
2. **The gate reads every file that runs commands** (fq7). Each
   `package.json`'s `scripts` values as shell lines, `barwise/Makefile`
   recipe lines, and the extensionless hooks under `barwise/.husky/`.
   `.beads/hooks/` stays out, vendored by the tracker, and the gate names
   that exclusion in its output.
3. **A call from above `barwise/` passes `--project`** (q07). A uv run or
   sync in a file outside `barwise/` (`.github/workflows/`, `.claude/`)
   must pass `--project` naming `barwise`, or sit in a workflow step whose
   `working-directory` is under `barwise/`.
4. **One Python manifest** (usv). The gate lists tracked files named
   `pyproject.toml`, `requirements*.txt`, `setup.py`, `setup.cfg` or
   `Pipfile`, and fails on any but `barwise/pyproject.toml`. The
   "outside the repo" clause of decision 4 goes to prose.
5. **The bootstrap is exact, and pinned twice** (suc). The allowlist
   entry matches a whole command segment, so nothing chains onto it. The
   session hook installs uv at a pinned version through the versioned
   installer URL, and a test fails when that version and CI's
   `uv==<version>` disagree, a parity check rather than a comment.

Out of scope: whether `uv.lock` is current (`uv lock --check` answers
that, a different question from how uv was invoked); commands inside
quoted strings, which the gate blanks on purpose (its header says why).

## Alternatives considered

- **Requiring `--locked` on every call that CI runs.** The npm scripts
  CI runs are the ones a developer runs too, where `--locked` would fail
  on any local lock drift. CI's own `uv sync --locked` step asserts the
  lock once. Rejected; the spec restates decision 1's CI clause as that
  step, and WS2 checks the step exists.
- **A shell parser.** A real one (bash's grammar) would read quoted
  commands too. The gate's text matching is a deliberate trade its header
  defends; a parser for uv's own argument grammar is enough here.

## Workstreams (each independently shippable)

### 1. Parse a uv call

`parseUv(segment)` in `python-uv-rules.mjs` returns `{ globals,
subcommand, args }` or null, from uv's documented global options (those
that take a value: `--directory`, `--project`, `--cache-dir`, `--color`,
`--config-file`, `--python`; flags otherwise). `uvFindings`, `uvArgsArray`
and the agent hook use it. Each planted form in the gap issues
(`uv -q run python -V`, `uv --directory barwise run --with x`, `uv run -w
x`, `"--with=sqlglot"` in an array, `["uv", "run", "--with", ...]` in a
`.py` subprocess call) lands as a red test first.

### 2. Every command-bearing file (provisional: not yet grounded)

`package.json` scripts, `barwise/Makefile` and `barwise/.husky/*`, each
with a planted violation red first; a test that CI holds a `uv sync
--locked` step.

### 3. `--project` from above `barwise/` (provisional: not yet grounded)

### 4. One manifest (provisional: not yet grounded)

### 5. The bootstrap (provisional: not yet grounded)

Fixes the session hook's unpinned install as its first commit.

## Open decisions (for review)

1. **The session hook's uv pin.** Recommended: the same version as CI's
   `uv==` pin, held equal by a test. The alternative, a `parity.manifest`
   set, compares text and would need the version to sit in the same shape
   in both files; a test reads each and compares the versions.
2. **`.beads/hooks/` stays unscanned.** Recommended: yes, as vendored
   code, with the exclusion printed by the gate so it is not silent.

## Risks and testing

- Widening what the gate reads can surface violations that exist today.
  Each workstream runs the widened gate on main before it lands, and
  fixes or allowlists (with a reason) what it finds in the same PR.
- The agent hook and the gate share `python-uv-rules.mjs`, so a parsing
  change reaches both; `python-uv-guard.test.mjs` runs beside the gate's
  own tests.

## Non-goals

- Running uv to see what it would resolve.
- Reading quoted command strings.
