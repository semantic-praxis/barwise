# Every Python execution resolves from the lockfile, and the sqlglot tier stops vanishing

Status: Workstreams 1-3 implemented (project moved; all six call sites
converted and the sqlglot tier runs in CI; check:python-uv gating the
rule); workstream 4 pending
Created: 2026-09-05
Last-updated: 2026-09-05
Tracking: barwise-921 (uv execution gate), barwise-916 (sqlglot absent in
CI), barwise-915 (the interpreter pin this completes)

## Principle

**Explicit over implicit**, applied to an input nobody declared. CLAUDE.md
already requires that a copy which must agree with other code carries a
check, and that a version input is pinned rather than inherited. Python
was exempt from both by accident: `.python-version` pins which
interpreter uv selects, and nothing pins which libraries it brings or
requires that uv be involved at all.

The gap is not theoretical. `SqlglotBridge` shells out to an ambient
`python3` and accepts **whatever sqlglot that machine carries** -- there
is no version check anywhere in the file -- and its output feeds
`parseLevel: "sqlglot"` results into models. Two machines, the same SQL,
potentially two different models, with nothing recording which sqlglot
produced either. That is the `numpy 2.4.6`-against-`2.5.2` divergence
barwise-915 closed, except in product output rather than dev tooling.

The second failure is the same one seen from the other side: because
sqlglot is installed nowhere in CI, eight tests **skip** rather than
fail -- 5 in `formats`, 3 in `dbt`, measured, not inferred -- and a
suite that silently shrinks is indistinguishable from one that passes.

## Should we move the Python project to `barwise/`? (resolved: yes)

**Because `uv run --frozen` does not fail when no project is
discoverable -- it silently runs an unpinned interpreter.** This is the
observation the rest of the design turns on, and it was not obvious:

```
$ cd barwise/packages/formats          # no pyproject.toml is an ancestor
$ uv run --frozen python -c "import sys; print(sys.executable)"
/root/.local/share/uv/python/cpython-3.13.7-linux-x86_64-gnu/bin/python3.13
$ uv run --frozen python -c "import sqlglot"
ModuleNotFoundError: No module named 'sqlglot'     # exit 0 from uv's view
```

So `--frozen` means "lockfile-resolved" only **when a project is
found**, and nothing says so when one is not. The single
`pyproject.toml` lives at `barwise/optimizer/`, which is a _sibling_ of
`barwise/packages/`, so every bridge invocation running with cwd inside
a package discovers nothing -- and would keep skipping exactly as it
does today, while appearing to obey the rule.

Moving the project to `barwise/` makes it an ancestor of every workspace
package, so discovery succeeds from any package directory without a
single path being written down. The optimizer becomes a package inside
that project rather than its own project.

The refinement that keeps this honest: discovery still fails for a
shipped CLI or VSIX on a user's machine, and that is correct. No project
means no sqlglot, `sqlglotAvailable()` returns false, and callers take
the regex cascade -- the same degradation that already fires when Python
is absent. Unavailable-and-honest beats available-and-unpinned.

## Scope

In scope:

- When any tracked script, source file, or workflow invokes Python, the
  system shall invoke it as `uv run --frozen --only-group <group>`,
  never as a bare `python3`, `python`, or `pip`.
- When a Python invocation needs only the standard library, the system
  shall name the empty `scripts` group, so no project dependency is
  installed to run it.
- When `check:python-uv` encounters a banned form -- `--with`,
  `--with-requirements`, `--isolated`, `uv pip`, a bare interpreter, or
  PEP 723 inline script metadata -- the system shall fail and name the
  file and line.
- When `check:python-uv` encounters a `uv run` without `--frozen` or
  `--locked`, the system shall fail.
- When an allowlist entry no longer corresponds to a violation, the
  system shall fail, so a fixed site forces its row out.
- When `audit:skips` finds a skipped test with no row in
  `skip-baseline.json`, the system shall fail; likewise for a stale row.

Deliberately not stated as a requirement here: whether an unavailable
sqlglot tier should **fail** a run rather than skip. That is the second
open decision below, and stating it in Scope would be deciding it.

Out of scope: SHA-pinning `actions/*@v7` refs (a supply-chain posture
question, not a reproducibility one -- tracked separately). Repo-root
path resolution for scripts generally (barwise-918); this spec removes
the cwd-dependence of the _Python_ invocations only, as a side effect of
project discovery.

## Inventory

| Site                                        | Current state                                   | Verdict                                  |
| ------------------------------------------- | ----------------------------------------------- | ---------------------------------------- |
| `packages/formats/src/sql/SqlglotBridge.ts` | 3 bare `python3`; no version check              | `uv run --frozen --only-group sqlglot`   |
| `packages/dbt/src/sql/SqlglotBridge.ts`     | identical but for the docblock                  | same edit; parity set enforces it        |
| `compile-runner.sh:158`                     | `python3 - report.json` (stdlib only)           | `--only-group scripts`                   |
| `scripts/check-beads.sh:29,30`              | `command -v python3`, `python3 -` (stdlib only) | `--only-group scripts`                   |
| `.github/workflows/ci.yml:218`              | `python3 -m pip install --quiet uv`             | allowlisted: bootstrapping uv itself     |
| `optimizer/pyproject.toml`, `uv.lock`       | the only Python project; sibling of `packages/` | moves to `barwise/`                      |
| `parity.manifest.json` `sqlglot-bridge`     | whole-file pair, `ignore: leading-docblock`     | untouched; it enforces the matching edit |

The two bridges differ **only** in their leading docblock -- verified by
`diff`, which reports hunks at lines 2-3 and 10-15 and nowhere else. The
parity set already covers the rest, so the identical edit is enforced
rather than hoped for; this is why the pair costs nothing extra here.

`packages/code-analysis` mentions `"python"` only as a detected _source
language_, never as an interpreter to run. It is untouched.

## Target architecture

```
barwise/
  pyproject.toml        <- moved up from optimizer/; the single project
  uv.lock                  [dependency-groups]
                             sqlglot = ["sqlglot==27.28.0"]   # the SQL tier
                             scripts = []                     # stdlib only
  .python-version       <- unchanged, at repo root beside .nvmrc
  optimizer/            <- now a package inside the project, not a project
  packages/
    formats/src/sql/SqlglotBridge.ts   uv run --frozen --only-group sqlglot
    dbt/src/sql/SqlglotBridge.ts       (identical; parity-enforced)
  scripts/
    check-python-uv.mjs   <- new gate: banned forms + required flags
    audit-skips.mjs       <- new ratchet over skipped tests
  skip-baseline.json      <- new; fails on a new skip AND on a stale row

Discovery: barwise/pyproject.toml is an ancestor of every package, so
`uv run` from any package cwd resolves it with no path written anywhere.
Outside the repo it resolves nothing -- and the tier degrades, by design.
```

## Alternatives considered

- **Leave the project at `optimizer/` and pass `--project <path>` at
  each call site.** Rejected: it writes a cwd-relative path into six
  places (barwise-918's exact class), and it must be recomputed inside a
  bundle where `import.meta.url` is empty -- the esbuild step already
  warns about this for `@barwise/learn`. Moving the project deletes the
  problem instead of distributing it.

- **`uv run --with sqlglot==27.28.0`, needing no project at all.** This
  was the working proposal until measured, and it is wrong: `--with`
  resolves against the index rather than `uv.lock`, and neither
  assertion flag closes it. Against a lock pinning `27.28.0`,
  `uv run --with sqlglot==27.20.0` runs 27.20.0 -- as do the `--frozen`
  and `--locked` spellings -- while `uv lock --check` still reports
  clean. It also pins a version at the call site, a fourth copy nothing
  checks.

- **Activate the venv and keep calling `python3`.** Rejected on
  checkability, which is the property that decides it here: `uv run` is
  static text a gate can read, while "was the venv activated" is a
  runtime property no grep can see. Activation also does not survive the
  boundaries where this bites -- each CI `run:` block, each git hook, and
  each editor-spawned process is a fresh shell.

- **Give `sqlglotAvailable()` an interpreter-override seam.** Rejected:
  it adds an interface to satisfy a test rather than removing a failure
  case, and it leaves the ambient-version defect intact.

## Workstreams (each independently shippable)

### 1. Move the Python project to `barwise/`

Relocate `pyproject.toml` and `uv.lock`, add the two dependency-groups,
adjust `[tool.hatch.build.targets.wheel]` for the new root, and update
CI's `working-directory`. Nothing else changes yet; the optimizer's 99
tests are the guard, and they must pass under `uv run --frozen` from the
new root before anything else lands.

First because every later step depends on discovery working, and because
it is the only step that can be verified entirely by an existing suite.

### 2. Convert the four non-bootstrap call sites

Both bridges to `--only-group sqlglot`; `compile-runner.sh` and
`check-beads.sh` to `--only-group scripts`. The bridges must be edited
identically -- `npm run check:parity` fails otherwise, which is the
point of the registered pair.

`check-beads.sh` runs in the pre-commit hook, so its cost is measured,
not assumed: `--only-group scripts` is **~35ms** warm against ~79ms for
a bare `python3`, because the empty group installs nothing. The
`sqlglot` group is ~110ms. The two groups coexist without thrashing
across `uv run` invocations, verified by alternating them.

**`uv sync` and `uv run` differ here, and the difference is
load-bearing.** `uv sync` is exact by default -- it removes packages not
declared for the selection it was given, and `--inexact` opts out --
whereas `uv run` is inexact by default, with `--exact` as the opt-in.
So `uv sync --extra dev` **prunes** the sqlglot group (observed:
`Uninstalled 1 package - sqlglot==27.28.0`) while alternating
`uv run --only-group` calls leave each other alone. An earlier revision
of this spec asserted the reverse -- "uv does not prune extraneous
packages absent `--exact`" -- which is true of `uv run` and false of
`uv sync`; the observations were right and the reason attached to them
was not.

The same asymmetry explains why this spec's central defect was
invisible for as long as it was:

```
cd <a directory with no project>
uv sync --frozen  -> error: No `pyproject.toml` found in current
                     directory or any parent directory
uv run  --frozen  -> ran anyway
```

**`uv sync` fails closed; `uv run` fails open.** Every diagnostic
instinct that reaches for `sync` gets told the truth, and the one
command the bridges actually use does not.

**This workstream also wires CI's JS lane**, and without that half it
delivers nothing: converting the bridges makes them ask uv for sqlglot,
but no CI job installs it today, so the eight tests would go on
skipping. The lane gains a uv bootstrap and `uv sync --locked
--only-group sqlglot` before the test steps. This is the step that
actually closes barwise-916; the conversion alone only changes which
interpreter is absent.

The red-to-green evidence is exact and already measured. Today:
`tests/SqlglotBridge.test.ts` reports **3 passed | 5 skipped** in
`formats` and **3 passed | 3 skipped** in `dbt` -- all eight skips are
in those two files, and the six passing tests are the ones that do not
touch the sidecar. Acceptance is those same files reporting **8 passed
| 0 skipped** and **6 passed | 0 skipped** in CI.

### 3. `check:python-uv`, the gate

A script over tracked sources, scripts, and workflows, wired into
`ci:local` and `ci.yml`. Fails on each banned form and on a `uv run`
missing `--frozen`/`--locked`. One allowlist entry -- the uv bootstrap
-- with its reason inline, and the entry is itself ratcheted: a stale
row fails, so fixing a site forces its removal.

Acceptance is red-then-green **per banned form**, not once: a planted
`--with`, a planted bare `python3`, a planted `uv pip`, a planted PEP
723 header, and a `uv run` with neither flag.

### 4. `audit:skips` and `skip-baseline.json`

The half that makes a vanishing suite loud. A ratchet over the vitest
JSON reporter with the same two-way property as `audit:rubric`: a new
skip fails, and so does a row whose skip is gone. Workstream 3 makes the
sqlglot tests _run_; this makes their disappearance a build failure if
they ever stop.

Reads a report the suite already produces, so it must not add measurable
time; if it does, the implementation is wrong.

## API and migration impact

- No package boundary moves and no public export changes. Both bridges
  keep their signatures; only the subprocess argv changes.
- `@barwise/formats` and `@barwise/dbt` gain a runtime requirement on
  `uv` **for the sqlglot tier only**. Absent uv, `sqlglotAvailable()` is
  false and callers take the regex cascade, which is the existing
  contract for a missing interpreter.
- The capability matrix is unchanged: no surface gains or loses a
  command.
- CI's JS lane gains a uv bootstrap and a `uv sync --frozen --only-group
  sqlglot` before tests. This is new coupling between the JS lane and
  Python tooling, and it is the price of testing the tier at all.

## Open decisions (for review)

- **Does moving the project belong in this spec or its own?** Moving
  `pyproject.toml` up is the enabling step, but it touches the optimizer
  lane, which is otherwise unrelated to either issue. _Recommendation:
  here, as workstream 1._ Splitting it means a PR whose only content is
  a move with no behaviour, reviewed without the reason it exists.

- **Should the sqlglot tests fail, or skip, when uv is genuinely
  absent?** Requiring the tier unconditionally makes a contributor
  without uv unable to run the suite; skipping is what produced
  barwise-916. _Recommendation: fail when `CI` is set, skip locally with
  a printed reason, and let `audit:skips` hold the local case._ This
  keeps the ratchet honest without making uv a hard prerequisite for
  a first-time checkout.

- **`--frozen` or `--locked` at runtime?** `--locked` additionally
  asserts the lock would not change, which is stricter but fails a
  developer mid-edit of `pyproject.toml`. _Recommendation: `--frozen` in
  code and scripts, `--locked` in CI_, so a stale lock fails the build
  without blocking local work.

- **Does the CLAUDE.md rule need amending?** It currently says
  `uv run --frozen` without noting that the guarantee is void when no
  project is discovered -- the defect this spec found. _Recommendation:
  amend it in workstream 1_, since a rule that overstates its own
  guarantee is the class this project keeps paying for.

## Risks and testing

- **The behaviour change is real and must be visible.** A shipped
  artifact loses the sqlglot tier unless a Python project is
  provisioned. The bridge docblock states this; `docs/` needs no change
  because the tier was never documented as promised to end users.
- **A baseline that only fails one way becomes a landfill.** Both
  `check:python-uv`'s allowlist and `skip-baseline.json` must fail on a
  stale entry as well as a new one. `audit-rubric.mjs` is the reference
  implementation and documents the property.
- **The gate must not be verified by reading it.** Each banned form gets
  a planted violation and a demonstrated red run before acceptance --
  the lesson from `eval-runner.sh`, where `check:shell`, `bash -n`, and
  all 25 gates passed over a default path that had never existed.
- Run `npm run ci:local` after each workstream. Workstream 1's real test
  is the optimizer's 99 tests under the new root; workstream 2's is the
  eight sqlglot tests running rather than skipping.

## Non-goals

- No new capability on any surface; the capability matrix is unchanged.
- No change to the SQL parse cascade's semantics, the sidecar program,
  or the shapes it emits -- only to which interpreter runs it.
- No attempt to make the sqlglot tier available to end users who have
  not provisioned a Python project. That is a packaging question, and
  pretending it is solved is what this spec exists to stop.
- No retroactive change to models produced by an unpinned sqlglot.

## Implementation notes

**Workstream 1 landed.** `pyproject.toml` and `uv.lock` moved from
`barwise/optimizer/` to `barwise/`; the two dependency-groups were added;
`[tool.hatch.build.targets.wheel]` and `[tool.pytest.ini_options]` were
repointed at `optimizer/`; CI's `working-directory` became `barwise` and
its uv calls became `--locked`; `compile-runner.sh` gained `--frozen` on
all three of its uv invocations; and both CLAUDE.md files were amended.

The move is verified by the property it exists for, red before and green
after, from the directory the bridges actually run in:

```
before:  cd barwise/packages/formats
         uv run --frozen python -c "import sqlglot"
         -> ModuleNotFoundError                      (exit 0 from uv)

after:   cd barwise/packages/formats
         uv run --frozen --only-group sqlglot python -c "import sqlglot"
         -> sqlglot 27.28.0
            exe /home/user/barwise/barwise/.venv/bin/python3
```

The optimizer's 99 tests pass from the new root
(`uv run --frozen --extra dev pytest -q`, 76.9s), which is what proves
the relocated hatch build target and `testpaths` are right rather than
merely plausible.

Two things went better than the brief predicted, both worth recording so
workstream 2 is not scoped from a stale assumption:

- **`compile-runner.sh` needed no restructuring.** The brief assumed its
  `cd optimizer && uv run ...` calls would have to change, because they
  name a directory that is no longer the project root. They do not:
  `barwise/` is now an ancestor of `optimizer/` as well, so discovery
  from inside `optimizer/` walks up and finds it. Only `--frozen` was
  added. The same reasoning is why no call site needs a `--project`
  flag anywhere.

- **The empty `scripts` group is faster than what it replaces**, not a
  tax paid for consistency: ~35ms warm against ~79ms for a bare
  `python3`, because naming a group with no packages skips the work of
  resolving any. `check-beads.sh` runs on every commit, so this was the
  cost most likely to make the rule unpopular, and it turns out to be a
  saving.

**Workstream 2 landed.** Both `SqlglotBridge` copies, `compile-runner.sh`
and `check-beads.sh` now invoke uv; CI gained an unconditional uv
toolchain step; and the sqlglot tier runs instead of skipping. The
acceptance criterion is met exactly:

```
before:  formats  3 passed | 5 skipped (8)      dbt  3 passed | 3 skipped (6)
after:   formats  8 passed | 0 skipped (8)      dbt  6 passed | 0 skipped (6)
```

Open decision 2 resolved as recommended, and both halves are verified
against a genuinely absent uv rather than argued:

| condition           | behaviour                                              |
| ------------------- | ------------------------------------------------------ |
| `CI=1`, uv absent   | `Failed Suites 1` -- the tier is a hard CI requirement |
| CI unset, uv absent | warning printed, `3 passed \| 5 skipped`               |
| uv present          | `8 passed \| 0 skipped`                                |

Four things the brief did not anticipate:

- **Naming the group is a safety mechanism, not just a smaller install.**
  In an unrelated Python project uv exits with ``Group `sqlglot` is not
  defined in the project's `dependency-groups` table``, so a shipped CLI
  run from inside someone else's repo reports the tier unavailable rather
  than silently borrowing their sqlglot version. Without the group name
  that case would have been "available and unpinned", which is the defect
  this spec exists to close, merely relocated.

- **`check-beads.sh` needs an explicit `--project`.** It may be sourced
  from anywhere and runs from the repo root, which is _above_
  `barwise/`, so cwd-based discovery would have failed there -- the same
  trap workstream 1 fixed for packages. It derives the path from
  `git rev-parse --show-toplevel`, which it already called.

- **uv became a dependency of every CI run, including docs-only ones**,
  because `check:beads` runs on those by design (tracker edits _are_ the
  docs-only case). That is a real cost on the deliberately-cheap path,
  accepted rather than hidden.

- **uv itself was unpinned**, which is this spec's own principle
  unapplied one level up: the tool that enforces the pins had none. This
  container carries 0.8.17 and 0.12.7 on PATH simultaneously, and CI's
  `pip install uv` took whatever pip resolved that day. Now pinned. The
  three behaviours the design rests on were verified identical on both
  versions first, so the pin is for reproducibility, not a known
  incompatibility.

**Workstream 3 landed.** `check:python-uv` is gate 9 of 26, wired into
`ci.yml` (from which `ci-local.mjs` derives its list, so it appeared in
both at once). Nine planted violations, one per banned form, plus a
stale-allowlist case and two false-positive guards.

The per-form requirement earned its keep immediately: **the PEP 723 rule
was dead on arrival**, because `isComment()` skips `#` lines for `.py`
and a PEP 723 block _is_ a `#` block, so the check was unreachable. An
aggregate "gate goes red on a bad repo" test would have passed while one
of five rules did nothing.

The gate also found two live defects on its first run, neither of them
an invocation: `eval-runner.sh` told operators to
`cd optimizer && python -m barwise_optimizer.compile`, and `compile.py`
told them to `uv sync`. Both were instructions to run Python the banned
way, in a repo whose rule says otherwise. Both now name the command
`compile-runner.sh` actually uses.

One deliberate limit, stated rather than discovered later: the gate
blanks quoted strings before looking for a command, so
`echo "== uv sync"` is prose rather than an invocation. The trade is that
a genuine `bash -c "python3 ..."` would be missed. None exists here, and
the alternative -- flagging every mention, including the gate's own error
text -- is how a gate gets switched off.
