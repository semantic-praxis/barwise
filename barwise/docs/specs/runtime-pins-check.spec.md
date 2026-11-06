# `check:pins`: the runtime pins, and the runtimes that ran

Status: WS1 implemented 2026-11-06 (barwise/.python-version with a parity set, README's copy of the Node version removed, check:pins in CI, probes for node-from-nvmrc and python-minor, verify-running recorded unprobed; check:python-uv's JS rule now asks for --frozen only where run or sync appears, as its shell rule does)
Created: 2026-11-06
Last-updated: 2026-11-06
Plan-reviewed: 9e07b177 (code-review, pr-review)
Tracking: barwise-ym8.gc9 (adr-refactor batch 6, runtime half),
barwise-ym8.q89, barwise-ym8.52y, barwise-ym8.eq3, barwise-920,
barwise-g32, barwise-8hs, barwise-1045
Touches: +barwise/scripts/check-pins.mjs, +barwise/.python-version,
barwise/parity.manifest.json, barwise/review-tiers.json, README.md,
barwise/scripts/tests/, barwise/package.json, package.json,
.github/workflows/ci.yml, barwise/docs/adr/pinned-runtimes.md,
barwise/docs/adr/probes.json, barwise/docs/ARCHITECTURE.md,
barwise/docs/specs/deterministic-guards.spec.md,
barwise/scripts/check-python-uv.mjs

## Principle

`docs/adr/pinned-runtimes.md` pins Node in `.nvmrc` and Python's minor
in `.python-version`, and says to verify the interpreter that ran, not
the file that asked. Nothing checks any of the three. This grounds
`deterministic-guards.spec.md` workstream 4 (`check:pins`, approved),
inside the line that spec drew: `check:pins` holds that each runtime has
one declared authority that the tools read, and the version that ran;
two copies that must agree go in `parity.manifest.json`, which that
spec's Alternatives chose over a second must-agree mechanism.

## The reading this spec starts from (main at 478d0fd8)

- All four workflows set Node with `node-version-file: .nvmrc`; nothing
  stops one naming a literal version (barwise-ym8.q89). The session hook
  reads `.nvmrc`. `README.md` restates the version ("currently 26.7.0")
  with nothing checking it (barwise-8hs).
- `.python-version` (3.13) sits at the repository root. Measured with uv
  0.11.32 in a scratch project with the file only in the parent: `uv
  python install` reads it (so CI installs 3.13, as the ADR says), and
  `uv python find`, and so `run` and `sync`, do not. With a copy in the
  project directory, `find` honours it. So outside CI the interpreter
  floats within `requires-python = ">=3.13"` (barwise-g32,
  barwise-ym8.52y).
- No gate reads back the Node or Python that ran (barwise-1045,
  barwise-ym8.eq3).
- `review-tiers.json` names `.python-version` with a file-shaped glob,
  so a second tracked file of that name fails `check:review-tiers`
  unless the row reaches or acknowledges it (plan review).

## Scope

1. **`barwise/.python-version`**, a copy of the root file beside
   `pyproject.toml`, where `uv python find`, `run` and `sync` read it.
   The pair is a whole-file set in `parity.manifest.json`, so
   `check:parity` fails when they differ. `review-tiers.json`'s Python
   row adds the path. Decision 2's "beside `.nvmrc`" stays true.
2. **`README.md`** says "the version in `.nvmrc`" and drops the number:
   a copy removed rather than checked.
3. **`check:pins`**, findings (exit 1), on the declared authorities:
   - a workflow `actions/setup-node` step without `node-version-file:
     .nvmrc`, or with `node-version`;
   - the session hook not reading `.nvmrc`;
   - `.python-version` missing at the root or beside `pyproject.toml`,
     or naming more than a minor (`3.13`, never `3.13.12`, decision 2).

   Refusals (exit 2), reading back what runs:
   - the Node running the gate on another major than `.nvmrc`;
   - the Python that `uv python find --show-version` resolves for the
     project on another minor than the pin; or uv absent or failing.
     The project is passed by absolute path from the script's own
     location, so the answer is the same from the root, `barwise/` and
     a package (gate-refusal-contract decision 3). `find` reads and
     writes nothing, unlike `uv run`, which would sync and could
     rebuild a venv (plan review). It is what uv would start for every
     `uv run` here, including a venv already on another minor, which is
     the case the file alone cannot show.

   The exact versions are printed on every run, so a reading is
   attributable. A Node patch differing from `.nvmrc` is printed, not
   refused (open decision 2).
4. **Wiring.** A `ci.yml` step with no `if:`, after the Python toolchain
   step; `ci:local` derives it, so the pre-push hook runs it.

Out of scope: the runner image (open decision 1); uv's own version
(python-uv-widened WS4); `engines.node` and `requires-python` floors,
which are ranges, not copies of the pin; whether `uv.lock` is a single
resolution (barwise-g32's other half).

## Alternatives considered

- **Divergence checks inside `check:pins`.** Rejected by
  deterministic-guards' Alternatives ("a second, parallel notion of
  'these two must agree'"); the copy goes in the parity manifest.
- **`uv run --frozen --project barwise python -V`** for the readback.
  It syncs the project (dspy and its tree, with no `--only-group`) on
  every docs-only run and every fresh pre-push worktree, can recreate a
  venv, and from `barwise/` a relative `--project barwise` names a
  directory that does not exist (plan review). Rejected for `uv python
  find`.
- **Moving `.python-version` into `barwise/`.** One file, but it
  rewords decision 2 (open decision 3).
- **`requires-python = "==3.13.*"`.** Rewrites `uv.lock` with a local uv
  older than CI's. Rejected until uv is pinned locally.

## Workstreams

### 1. The copy, the gate, and CI

Scope 1 to 4; `check-pins.mjs` with tests planting each finding and
refusal red (the uv readback through a stand-in `uv` on a restricted
`PATH`); the npm script, root forwarder and `ci.yml` step; probes for
`node-from-nvmrc` (a workflow's `node-version-file` replaced with
`node-version: 26`) and `python-minor` (`barwise/.python-version` set
to `3.13.12`, which names more than a minor), with `verify-running` recorded
unprobed (it reads the running environment); the ADR and
deterministic-guards WS4's status. `fault-matrix` now has a node gate
that needs uv; on a machine without uv it reads UNREADABLE, which the
ADR states.

## Open decisions (for review)

1. **The runner image.** deterministic-guards WS4 says `runs-on` never
   names a floating image. Pinning it means choosing an Ubuntu version
   in four workflows, which this session cannot confirm against what
   `ubuntu-latest` serves today. Recommended: the owner picks it, and
   `check:pins` then adds the rule.
2. **Node patch at pre-push.** Recommended: refuse another major, print
   a patch difference; CI runs the exact pin.
3. **Copy or move `.python-version`.** Recommended: the checked copy.

## Risks and testing

- A machine without uv is refused at pre-push; the session hook
  installs uv, and the refusal names the fix.
