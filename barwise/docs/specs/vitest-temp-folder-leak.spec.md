# A test run leaves nothing in the temp directory

Status: Proposed

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-fvi
Touches: barwise/package-lock.json,
barwise/packages/cli/package.json,
barwise/packages/code-analysis/package.json,
barwise/packages/core/package.json,
barwise/packages/dbt/package.json,
barwise/packages/diagram/package.json,
barwise/packages/diagram-ui/package.json,
barwise/packages/formats/package.json,
barwise/packages/learn/package.json,
barwise/packages/llm/package.json,
barwise/packages/mcp/package.json,
barwise/packages/promptlab/package.json,
barwise/packages/vscode/package.json,
+barwise/scripts/tests/vitest-tmp.test.mjs

When a vitest run ends, it shall leave nothing behind in the temp
directory. Today every run leaves one `/tmp/<21-character id>/ssr/` folder,
about 4 MB of transformed modules. On 2026-10-25 a session container held
about 26,000 of them. The per-session disk allowance ran out, `npm ci` in
the pre-push worktree failed with ENOSPC, and the push gates never ran.
On 2026-10-28 the same container held 497 again.

The cause is upstream and already fixed there. Vitest 5.0.1, the locked
version, never removes the temp folder its core instance creates. Vitest
5.0.5 adds `Vitest._clearTmpDir()` and calls it on close. The fix is the
version bump, plus a test that fails if a later version brings the leak
back.

## Principle

A finding closes with a mechanism, not a note. Upgrading fixes today's
leak, but nothing would notice if a later version or a config change
brought it back. The leak only shows up as a full disk days later, in a
gate that then cannot answer. So the bump comes with a test that runs
vitest and checks that the temp directory is empty afterwards.

## Observed today (at cf334d86)

- `package-lock.json` resolves `vitest` and `@vitest/coverage-v8` to
  5.0.1. Every package declares both as `^5.0.1`.
- In vitest 5.0.1 (`dist/chunks/index.DzobfTyw.js`), the `Vitest` class
  sets `_tmpDir = join(tmpdir(), nanoid())`. Its module fetcher writes
  temp copies there when the pool is `forks`, the default: that pool's
  `cacheFs = true`. Each `TestProject` has its own temp folder and
  removes it in `clearTmpDir()` on close. Nothing removes `_tmpDir`.
- Measured: one `npx vitest run tests/OssieVerify.test.ts` in
  `packages/formats` left one new folder holding only `ssr/`, 3.9 MB.
- Vitest 5.0.5 (`dist/chunks/cli-api.De07GUeT.js`) removes `_tmpDir` in
  `_clearTmpDir()`, called from close. It was released 2026-10-15.
  `@vitest/coverage-v8@5.0.5` declares a peer dependency on exactly
  `vitest@5.0.5`.
- `os.tmpdir()` reads `TMPDIR`, so a run pointed at a fresh directory can
  be checked for what it leaves there.

## Scope

- Every package shall declare `vitest` and `@vitest/coverage-v8` as
  `^5.0.5`, and the lockfile shall resolve both to 5.0.5. The floor names
  the first version with the fix, so a fresh resolve cannot pick the
  leaking one.
- `scripts/tests/vitest-tmp.test.mjs` shall run one package's vitest on
  one small test file, with `TMPDIR` set to a new empty directory, and
  shall fail if the directory is not empty after the run. It runs under
  `npm run test:scripts`, which CI and the pre-push gate already run.

Out of scope:

- Removing folders an earlier version already leaked. They belong to the
  container, not the repository. A fresh session starts clean.
- Other vitest changes between 5.0.1 and 5.0.5. They are patch releases,
  and the full suite on the bumped lock is the check.

## Workstreams

### 1. Bump, and test that the temp directory stays empty

The changes above. Each item below is pinned or measured:

- With 5.0.5, the run measured above leaves no new folder in `/tmp`.
- The new test passes on 5.0.5 and fails on 5.0.1. The red check
  reinstalls 5.0.1 locally, without committing it.
- The full monorepo suite and coverage pass on the bumped lock.

## Open decisions

1. **Bump, or work around it in our config?**
   - (a) Bump to 5.0.5 (recommended). The fix is upstream's, and nothing
     of ours has to know vitest's internals.
   - (b) Register an `onClose` hook in `vitest.shared.ts` that removes
     `vitest._tmpDir`. This works on 5.0.1, but it reaches into
     `_tmpDir`, a field outside vitest's API, and it would need deleting
     after the bump anyway.
   - (c) Switch the pool to `threads`, which makes no temp copies. That
     changes test isolation across 12 packages to avoid a leak.

   Recommend (a).
2. **What the test runs.** One small test file in `@barwise/learn`, the
   smallest package with a vitest config (recommended), so the test
   costs a few seconds. The leak is in vitest's close path, not in what
   is tested, so any one file shows it.

## Risks and testing

A patch upgrade can change test behaviour. The full suite and the
coverage floors on the new lock are the check, through the pre-push gate
and CI.
