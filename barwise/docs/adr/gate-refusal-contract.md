# Gate refusal contract

Scope: process
Date: 2026-09-17
Tracking: barwise-ubc, barwise-987, barwise-989, barwise-1012,
barwise-1019, barwise-ydl, barwise-shq, barwise-vt2, barwise-w43,
docs/specs/gate-refusal-contract.spec.md

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
   could not answer.** A refusal names what the gate could not see and
   never prints PASS.
2. **A gate refuses when it cannot see its input, and never uses its
   finding code for that.** That covers `git` failing or printing
   nothing, an empty tracked-file listing, a missing tool, a missing
   manifest or lockfile, and a shallow clone when the gate reads
   history. Each gate names its own preconditions.
3. **A gate gives the same reading from the repository root,
   `barwise/` and a package directory**, the three directories the
   spec requires and measures. No caller has to pass a root.
4. **Whatever reads a gate keeps the third value.** `ci:local` reports
   REFUSED separately from FAIL and exits 2 when refusals are the only
   non-zero results. `mutate` refuses when its command already fails
   before any mutation. A test skips only when every run refuses, since
   a partial refusal is the defect itself.
5. **A gate does not write to the tree it reads.**

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
- `npm run fault-matrix` runs each `ci.yml` step whose npm script
  contains a `node scripts/<name>.mjs` segment, also inside an `&&`
  chain (25 of the 43 npm steps on main), under `git` empty, `git`
  absent, a shallow answer and three working directories. It refuses
  when a gate changes `git status --porcelain`, and when a script
  chains two node gates. It reads exit codes only. It does not check
  a refusal's message, has no missing-tool, manifest or lockfile axis,
  and does not see a write undone before the gate exits. It runs on
  demand, not in CI, as decided in the spec ("Should WS3 run in CI at
  all? (resolved: no.)"). Its FALSE GREEN verdict is pinned against
  `classify` in `gates.test.mjs`.
- The other 18 npm steps are outside the matrix, among them
  `test:trial`, `test:mcp-checks`, `test:cli-checks`, `check:beads`,
  `validate:examples`, `test:optimizer` (pytest through uv), turbo's
  `build`, `lint` and `test:coverage`, and the VS Code check and bundle
  steps. Nothing checks them against this contract.
- A reading taken for this ADR ran 24 of the 25 matrix gates (not
  `test:scripts`). 21 conform on all four axes. `check-lockfile-agrees`
  refused unperturbed, correctly, because the checkout's `node_modules`
  came from another install. The reading found two breaks, and an
  earlier run in the same checkout without `node_modules` found a third:
  - `check-tracker-closes` gives a FALSE GREEN when `git` prints
    nothing: an empty merge-base and an empty tracker read as a clean
    diff, exit 0 (barwise-ydl);
  - `audit-rubric` exits 1 when `packages/promptlab/dist` is missing, and
    `check-depcruise-gate` exits 1 with a parse stack trace when
    dependency-cruiser is not installed (barwise-shq).
- Two more breaks found by reading the code:
  - `npm run depcruise` exits with its count of error violations, so two
    violations exit 2, and `ci:local` reports a real finding as REFUSED
    (barwise-vt2);
  - `check-depcruise-gate` writes a probe file into
    `packages/core/src` and deletes it in a `finally`, so a killed run
    leaves it in the tree (barwise-w43).
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
