# check:python-uv, widened to the rest of the ADR

Status: WS1 implemented 2026-11-06 (parseUv: subcommand by name, run options end at the launched command, banned flags by prefix with -w, UV_NO_PROJECT and UV_ISOLATED read, UV_FROZEN and UV_LOCKED accepted; shared by the gate, its args-array and .py-list checks, and the agent hook); WS2 implemented 2026-11-06 (package.json scripts, Makefile recipes and the git hooks are read; .beads/hooks/ named as unread; UV_SUBCOMMANDS completed and held to the installed `uv help` by a test); WS3 implemented 2026-11-06 (barwise/pyproject.toml and barwise/uv.lock must be tracked, and no other pyproject.toml, requirements file, setup.py, setup.cfg, Pipfile, uv.toml, pylock.toml or uv.lock may be); WS4 designed after the owner resolved open decision 1 (2026-11-06)
Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 3), barwise-ym8.fq7,
barwise-ym8.l69, barwise-ym8.q07, barwise-ym8.usv, barwise-ym8.suc
Plan-reviewed: 0bd887bb (code-review, pr-review)
Touches: barwise/scripts/check-python-uv.mjs, barwise/scripts/lib/python-uv-rules.mjs,
barwise/scripts/hooks/python-uv-guard.mjs, barwise/scripts/tests/,
+barwise/scripts/install-uv.sh, .github/workflows/ci.yml,
.claude/hooks/session-start.sh, barwise/docs/adr/python-from-the-lockfile.md,
barwise/docs/adr/probes.json, barwise/docs/ARCHITECTURE.md,
barwise/docs/adr/pinned-runtimes.md, CLAUDE.md

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

In scope, by gap issue:

1. **A uv call is parsed, not matched** (fq7, l69). One function reads a
   command into uv's subcommand and the options uv itself receives:
   - the subcommand is found by name, from uv's subcommand list (`run`,
     `sync`, `pip`, `tool`, `lock`, `add` and the rest), not by
     skipping a hand-kept list of value-taking global options. Such a list
     was wrong in this spec's first draft (`--python` is not a global
     option, `--allow-insecure-host` is; plan review, 2026-11-06);
   - for `run`, the options end at the command it launches (or `--`):
     `uv run python x.py --frozen` passes `--frozen` to `x.py`, and uv
     re-locks. Run options that take a value (`--only-group`, `--group`,
     `--extra`, `--with`, `--with-requirements`, `--with-editable`,
     `--project`, `--directory`, `--env-file`, `--python`, `--index`)
     consume their value; an unknown option is read as a flag;
   - banned flags match by prefix, so `--with-editable` stays caught
     (the substring check catches it today), plus the `-w` alias and
     `=` forms;
   - the environment spellings count: `UV_NO_PROJECT` or `UV_ISOLATED`
     in a leading assignment is a finding, and `UV_FROZEN` or `UV_LOCKED`
     there satisfies the assertion.
     Shell lines, JS args arrays (a literal that starts with a banned flag)
     and `.py` subprocess lists all read through it, and so does the agent
     hook, which shares the rules module.
2. **The gate reads every file that runs commands** (fq7). Each
   `package.json`'s `scripts` values as shell lines, `barwise/Makefile`
   recipe lines, and the extensionless hooks under `barwise/.husky/`.
   `.beads/hooks/` stays out, vendored by the tracker, and the gate names
   that exclusion in its output.
3. **The project and its manifests** (q07, usv). `barwise/pyproject.toml`
   exists and is the only file of its kind tracked, and no other file that
   changes resolution is: `requirements*.txt`, `setup.py`, `setup.cfg`,
   `Pipfile`, `uv.toml`, `pylock.toml`, or a `uv.lock` other than
   `barwise/uv.lock`. Decision 3's per-call `--project` rule for tracked
   scripts is not checked: whether a call runs from above `barwise/` is
   its working directory, which the text cannot show (quoted paths are
   blanked, and `ci.yml` sets a job-level `working-directory`), and the
   agent-hook spec's R6 leaves tracked scripts to review by decision. The
   agent hook keeps checking the calls an agent runs.
4. **One installer for uv, which verifies what runs** (suc). Following
   `scripts/install-gitleaks.sh`, one `scripts/install-uv.sh` holds the
   version, installs it, and checks `uv --version` afterwards; `ci.yml`
   and the session hook both call it, and the session hook calls it even
   when a uv is already present, so a cached older uv is replaced. No
   allowlist entry remains: the installer downloads the release tarball,
   so no bare interpreter is exempted (WS4).

Out of scope: whether `uv.lock` is current (`uv lock --check` answers
that, a different question from how uv was invoked); commands inside
quoted strings, which the gate blanks on purpose (its header says why).

## Alternatives considered

- **Checking decision 3 per call in tracked files.** Rejected in Scope 3:
  the working directory is not in the text, and a check that guessed it
  would both miss the ADR's own example (`check-beads.sh` sits inside
  `barwise/` and runs from above it) and fail correct calls in `ci.yml`.
- **A parity test between two uv pins.** Rejected for one installer (open
  decision 1): it guards a duplicate the installer removes, and compares
  files rather than the uv that runs.
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

`parseUv(segment)` in `python-uv-rules.mjs` returns `{ env, subcommand,
options }` or null, per Scope 1. `uvFindings`, `uvArgsArray` and the
agent hook use it. Each planted form lands as a red test first: `uv -q
run python -V`, `uv --directory barwise run --with x python`, `uv
--allow-insecure-host h run --with x python`, `uv run -w x python`, `uv
run --frozen --with-editable ./p python`, `uv run python x.py --frozen`,
`UV_NO_PROJECT=1 uv run --frozen python`, `"--with=sqlglot"` in an args
array, and `["uv", "run", "--with", ...]` in a `.py` subprocess call.
The gate runs over main before it lands; anything it newly finds is fixed
or allowlisted with a reason in the same PR.

### 2. Every command-bearing file (provisional: not yet grounded)

### 3. The project and its manifests (provisional: not yet grounded)

### 4. One installer for uv

Open decision 1 is resolved (owner, 2026-11-06: the script). Grounded
on main at cfff1486 and revised after plan review:

- **Today.** CI's "Python toolchain (uv)" step runs `python3 -m pip
  install --quiet uv==0.12.7`, which `check:python-uv` exempts through
  its one ALLOWLIST row (a substring of the line; `gates.test.mjs` has a
  `UV_BOOTSTRAP` fixture and a stale-entry test). The session hook runs
  astral's `install.sh` only when `~/.local/bin/uv` is absent, so a
  container keeps its first uv (0.11.32 here, with `uvx` beside it).
  ADR decision 1 allows a bare `python3` "apart from decision 5";
  `pinned-runtimes.md` says uv is pinned only in CI.
- **The installer.** `scripts/install-uv.sh <BIN_DIR>`, in the shape of
  `install-gitleaks.sh`: one `VERSION` (0.12.7) and the published
  SHA-256 of each platform's release tarball (x86_64 and aarch64, Linux
  and macOS, from the release's `.sha256` files, checked against a
  download of the Linux x86_64 tarball, 2026-11-06). Presence is read as
  `"${BIN_DIR}/uv" --version`, never `command -v` (plan review: the
  first uv on PATH is the cached one); at the pin it is left alone, any
  other version is replaced. The tarball is verified before `tar` runs;
  only `uv` is installed, and a `uvx` in `BIN_DIR` is removed, since
  decision 2 bans it. `"${BIN_DIR}/uv" --version` is read back, and
  anything but the pin exits 2.
- **Callers.** `ci.yml`'s Python step runs `bash scripts/install-uv.sh
  "${HOME}/.local/bin"`, puts that directory first on `PATH` for the rest
  of the step and on `GITHUB_PATH` for later ones. The session hook runs
  it with `"${HOME}/.local/bin"` on every start, non-fatally, as it runs
  the gitleaks installer.
- **No bare interpreter anywhere.** The GitHub release replaces `pip`,
  so ADR decision 1 drops "apart from decision 5", and `check:python-uv`
  drops its ALLOWLIST and the stale-entry ratchet with it (there is
  nothing left to exempt; the bootstrap line, planted, now fails as a
  bare `python3`). Its OK line stops mentioning an exemption.
- **Decision 5's holder.** Restated to "uv is installed only by
  `scripts/install-uv.sh`, at its pinned version, verified before it is
  unpacked". An allowlist over the callers' lines cannot hold it, because
  the same lines run `uv python install` and `uv sync` (plan review). It
  is held instead by what runs: `check:pins`, which CI runs after the
  Python step and pre-push runs through `ci:local`, reads `uv --version`
  and refuses (exit 2) when it is not the installer's `VERSION`, read
  from the script, however that uv was installed; and a test that the
  installer, given a download no digest matches, exits 2 before `tar`
  runs. Enforced-by: `npm run check:pins (uv-bootstrap)` (recorded
  unprobed: a file edit cannot change the uv that runs) and `tests
  (uv-bootstrap)`; the `none (barwise-ym8.suc)` entry and the old probe
  row go, and suc closes in a tracker PR.
- **Text that changes with it.** Scope 4 above (no allowlist row
  remains); `ci.yml`'s comments on pip; `install-gitleaks.sh`'s header;
  the ADR's Consequences on the allowlist and on decision 5's gap;
  `pinned-runtimes.md`'s "uv is pinned only in CI"; the root CLAUDE.md's
  "the one exception is CI's pinned uv bootstrap".
- **Tests.** `session-start.test.mjs` stubs `install-uv.sh` as it stubs
  the gitleaks installer, and asserts the hook calls it with
  `~/.local/bin` on a warm start; `check-pins.test.mjs` plants a stand-in
  uv on another version (refused) and the pinned one (passes).

## Open decisions (for review)

1. **How uv is installed** (decision 5's wording). **Resolved (owner, 2026-11-06):
   the script, "simple and consistent".** WS4 builds it and restates
   decision 5 in the same PR. Recommended was: one
   `scripts/install-uv.sh`, called by CI and the session hook, holding the
   version and checking the uv that runs, as `install-gitleaks.sh` does
   for gitleaks. Decision 5 says CI installs uv with `python3 -m pip
   install uv==<pinned>`; the script may keep that form or use the
   versioned astral installer, and decision 5 is restated to "uv is
   installed only by `scripts/install-uv.sh`, at its pinned version".
   That is the owner's call because it changes a decision's text. Today
   the session hook installs an unpinned uv only when none is present:
   this container runs uv 0.11.32 against CI's 0.12.7.
2. **`.beads/hooks/` stays unscanned.** **Resolved (owner, 2026-11-06): yes.**
   Recommended was: yes, as vendored
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
