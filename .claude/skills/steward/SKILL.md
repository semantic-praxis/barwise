---
name: steward
description: Use when driving a barwise PR to green - acting on CI failures, review events, or merge conflicts as the PR's agent. Carries only the repo-specific mechanics the generic drive-to-green rules cannot know; conventions themselves live in CLAUDE.md, AGENTS.md, and the scripts this file points at.
---

# Stewarding a barwise PR

Scope note: this file adds barwise mechanics on top of the generic
PR-driving rules; it does not restate them. Where a rule here names a
command or an order, the cited file is the authority and this is the
pointer (spec: `docs/specs/steward-skill.spec.md`).

## 1. Tracker conflicts: `.beads/issues.jsonl`

The issue tracker is a git-native JSONL file; a merge conflict there
is data to reconstruct, not hunks to pick.

- Never commit merge markers, and never resolve by keeping one side
  wholesale -- both sides usually added different issues. Take the
  union of issues by id; for an id both sides changed, keep the line
  with the later `updated_at`.
- Two sessions can allocate the same new id concurrently
  (`docs/specs/beads-issue-crud-scripts.spec.md`); that surfaces as a
  duplicate-id error. Re-file the newer issue under a fresh id with
  `node scripts/beads-crud.mjs create` and delete the colliding line
  with `... delete`.
- Write lines only through `scripts/beads-crud.mjs` -- canonical form
  (compact JSON, `&<>` escaped) is what the validator enforces.
- Gate: `npm run check:beads -- --strict` must pass before the
  resolution is committed. CI runs it on every PR.

## 2. Generated files: regenerate, never hand-edit

A conflict or a failing drift test in a generated file
(`builtins.generated.ts`, `examples/output/`, tutorial or reference
output, golden files) is fixed by rerunning its regenerator on the
merged source, not by editing the output. The failing drift test's
message names its regenerator; the full list is the `regen:*` scripts
in `barwise/package.json` (`regen:builtins`, `regen:examples`,
`regen:tutorial`, `regen:references`), plus `UPDATE_GOLDEN=1` for the
golden tests that document it.

## 3. The duplication ratchet can fire on your own fix

`npm run audit:duplication -- --check` fails on any new unclassified
candidate and on a stale entry for a finding your diff resolved. Both
are yours: update `barwise/audit-baseline.json` in the same commit
(classify the new candidate, or delete the stale entry). The rubric
is the `duplication-audit` skill.

## 4. Before pushing a fix

Run from `barwise/`, cheap checks first -- the order and full set are
owned by `.github/workflows/ci.yml`:

```sh
npm run fmt && npm run check:beads -- --strict
npm run oxlint && npm run depcruise && npm run check:depcruise-gate
npm run check:parity && npm run audit:duplication -- --check
npm run lint && npm run build && npm test
```

Two traps:

- A per-package `tsc --noEmit` reads its dependencies' `dist`, not
  their source -- run `npm run build` from `barwise/` first whenever a
  change crossed a package boundary (root `CLAUDE.md`).
- The pre-commit hook formats staged files and runs build plus
  affected tests; on failure it restores the staged state, discarding
  fixes it applied -- re-stage and commit again rather than assuming
  the fixes stuck.
- The pre-push hook runs the full `ci:local` gate list, so the command
  above is a subset of what the push will check anyway. Budget ~30s
  warm, ~3min when sources changed.

A PR touching only Markdown and `.beads/` takes CI's docs-only path
(formatting and tracker checks only), so tracker-only and docs-only
pushes are cheap. The required status check is `ci (22)`.

## 5. After the PR merges

Close the issues it resolved via
`node scripts/beads-crud.mjs close <id> --reason "..."` in a
tracker-only follow-up commit -- not in the code PR, whose body should
say the closures follow. Then push and verify per the Session
Completion section of the root `CLAUDE.md`: work is not done until
`git status` shows up to date with origin.
