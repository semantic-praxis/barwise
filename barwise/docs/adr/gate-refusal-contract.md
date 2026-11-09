# Gate refusal contract

Scope: process
Date: 2026-09-17
Tracking: barwise-ubc, barwise-987, barwise-989, barwise-1012,
barwise-1019, barwise-ydl, barwise-shq, barwise-vt2, barwise-w43,
docs/specs/gate-refusal-contract.spec.md
Enforced-by: npm run fault-matrix (three-results, refuse-not-find, cwd-invariant),
tests (three-results, refuse-not-find, cwd-invariant, readers-keep-third),
none (barwise-ym8.j31: three-results),
none (barwise-ym8.aep: readers-keep-third),
none (barwise-ym8.if3: no-writes)

## Context

A gate's caller reads one line and one exit code. With two values,
`PASS` meant both "the thing is fine" and "I could not see the thing",
and the two were byte-identical. `audit-gate` audited a package
directory with no lockfile, reported PASS, and advised deleting the
acceptance for a live high-severity advisory. The spec's readings of
the node gates that existed then (13, then 14), the rejected
alternatives (a `--root` flag on every gate, randomised faults) and the
corrections made during grounding are in the spec above.

## Decision

1. **A gate has three results: exit 0 pass, exit 1 a finding, exit 2
   could not answer.**{#three-results} A refusal names what the gate could not see and
   never prints PASS.
2. **A gate refuses when it cannot see its input, and never uses its
   finding code for that.**{#refuse-not-find} That covers `git` failing or printing
   nothing, an empty tracked-file listing, a missing tool and a shallow
   clone when the gate reads history, each pinned by the matrix. A missing
   manifest or lockfile is each gate's own precondition, named in the gate
   and tested by its own tests; the matrix does not perturb it.
3. **A gate gives the same reading from the repository root,
   `barwise/` and a package directory**{#cwd-invariant}, the three directories the
   spec requires and measures. No caller has to pass a root.
4. **Whatever reads a gate keeps the third value.**{#readers-keep-third} `ci:local` reports
   REFUSED separately from FAIL and exits 2 when refusals are the only
   non-zero results. `mutate` refuses when its command already fails
   before any mutation. A test skips only when every run refuses, since
   a partial refusal is the defect itself.
5. **A gate does not write to the tree it reads.**{#no-writes}

## Consequences

- `scripts/lib/tracked.mjs` guards two `git` calls for the gates that
  use them: `REPO_ROOT` refuses when `git rev-parse --show-toplevel`
  fails or prints nothing, and `trackedFiles()` refuses on an empty
  listing. Every other `git` call a gate makes (merge-base, show, diff,
  log) is that gate's own to guard, as barwise-ydl shows. Tools,
  manifests and shallow clones are handled gate by gate.
- `gates.test.mjs` pins the git-failure refusal for a hand-kept list
  of about ten gates, though more than twenty scripts import
  `tracked.mjs` (barwise-1006, item 6, which counted an older list);
  cwd invariance for three scripts; and the `ci-local` and `mutate`
  refusals. CI runs it in `test:scripts`, guarded
  `if: steps.changes.outputs.docs_only != 'true'`, so it is skipped on
  a docs-only pull request and, like any step, once an earlier step
  fails. Refusal paths are mutation-tested only by hand (barwise-1049).
- `npm run fault-matrix` is the last step of CI's `ci` job, on pull
  requests that are not docs-only, with the `BASE_SHA` the PR-only gates
  read; `ci:local` runs it at pre-push on the same changes (option D of
  `gate-contract-enforced.spec.md`, owner 2026-11-06). It runs each
  `ci.yml` step whose npm script contains a `node scripts/<name>.mjs`
  segment, also inside an `&&` chain, under `git` empty, `git`
  absent, a shallow answer, each tool its own process execs gone from
  PATH (`node` and the shell are not perturbed; `git` has its own
  axes), and three working directories, in under three minutes. A gate that
  exits 0 having called a broken `git` or a missing tool (FALSE GREEN),
  exits 1 on it (CRASHED), or answers differently by directory
  (READING MOVED) is a finding; a gate whose unperturbed run is not 0 is
  a refusal. It also refuses when a gate changes
  `git status --porcelain` and when a script chains two node gates. It
  reads exit codes only: it does not check a refusal's message, has no
  manifest or lockfile axis, and does not see a write undone before the
  gate exits (`fault-matrix-axes.spec.md`, WS2). Its verdicts are pinned
  against `classify` in `gates.test.mjs`, and a probe per decision
  plants a gate that breaks it.
- The tool axis (`fault-matrix-axes.spec.md`, WS1) puts one logging wrapper
  per executable on the real PATH in a directory, runs each gate once on
  that PATH alone (the record pass, which is also its baseline), and
  reruns it once per tool the record pass saw the gate's own process exec,
  with that wrapper deleted. A call counts only when its parent is the gate
  (npm calling `env` beneath it does not), and a name that slips through
  goes on `TOOL_EXCEPTIONS` in `scripts/lib/ci-gates.mjs`, which the matrix
  reports as a finding once no gate reaches it. The set each gate reached
  is printed on every run. A canary refuses the run when the wrappers cannot
  log. A tool probed without an exec (`command -v`, `which`), one named by
  absolute path (`dprint` under `fmt:check`) and one a shell starts
  beneath the gate are not seen, so INDEPENDENT does not cover them; the
  report lists the gates whose source does either of the first two. CI
  installs `uv` (`scripts/install-uv.sh`) and `gitleaks`
  (`scripts/install-gitleaks.sh`) in steps of its own, `npm` and `npx`
  come with Node, and `shellcheck` is installed by no step: it is there
  because the `ubuntu-latest` runner image carries it. A tool absent on a
  runner makes the unperturbed gate refuse and the row UNREADABLE, which
  is the right answer.
- The matrix never runs itself, and leaves out the node gates named in
  `MATRIX_EXCEPTIONS` (`scripts/lib/ci-gates.mjs`), each with its
  reason; `fault-matrix -- --all` runs them on demand. A test fails on a
  name there that is not a node gate `ci.yml` runs, and on a step running
  `node scripts/...` in a form the matrix cannot resolve.
- The npm steps that are not node gates stay outside the matrix (owner,
  2026-11-06: the shell scripts stay out), among them
  `test:trial`, `test:mcp-checks`, `test:cli-checks`, `check:beads`,
  `validate:examples`, `test:optimizer` (pytest through uv), turbo's
  `build`, `lint` and `test:coverage`, and the VS Code check and bundle
  steps. Nothing checks them against this contract.
- The reading of 2026-11-06 (`gate-contract-enforced.spec.md`) ran 29
  gates in 746 seconds and found four breaks. With an earlier reading and
  the code, they were fixed in that spec's WS1:
  - `check-tracker-closes` read an empty merge-base and an empty tracker
    as a clean diff, a FALSE GREEN; it refuses both, and a close whose
    diff does not name the tracker (barwise-ydl);
  - `test-adr-model` reported failed cases when git was broken; it
    refuses when git cannot name the root;
  - `audit-rubric` exited 1 when `packages/promptlab/dist` was missing,
    and `check-depcruise-gate` exited 1 with a parse stack trace when
    dependency-cruiser could not run; both refuse (barwise-shq);
  - `npm run depcruise` exited with its violation count, which the OS
    keeps mod 256; `scripts/run-depcruise.mjs` exits by the count in
    the JSON summary (barwise-vt2).
- `run-script-tests` exits 0 with its shallow-clone skips printed, which
  decision 4's skip rule allows and the matrix reads as FALSE GREEN; the
  spec takes `test:scripts` out of the matrix for that reason.
- `check-depcruise-gate` wrote its probe file into `packages/core/src`
  and deleted it in a `finally`, so a killed run left it in the tree; it
  now probes a temporary mirror of the cruise root, and a test polls the
  tree while the gate runs (barwise-w43). Decision 5 stays a gap: nothing
  in CI watches every gate for such a write (`fault-matrix-axes.spec.md`,
  WS2).
- Other open gaps: the trial gate reports PASS over results older than
  its inputs (barwise-e0q); `ci:local` passes on a Node `.nvmrc` does
  not pin (barwise-1045); nothing reports unwired git hooks
  (barwise-1016).
- Exceptions, each decided where it is stated: third-party tools keep
  their own exit codes, and only a wrapper around them can refuse (spec,
  Scope, "Out of scope"); `python-uv-guard.mjs` uses exit 1 for "could
  not answer" because 2 blocks the command in Claude Code's hook contract
  (`agent-python-uv-hook.spec.md`, R5).
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule: `gate-refusal-contract.spec.md`; `REVIEW.md` (its opening,
  its severity list and "Always check" item 2); the `pr-review`
  checklist's repo-root line; the `fault-matrix.mjs` header; comments in
  `tracked.mjs` and `ci-local.mjs`; and `trial/README.md`. Another 42 tracked files name the spec,
  mostly to cite it for their own exit codes rather than to restate it.
