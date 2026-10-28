# A test run leaves nothing in the temp directory

Status: Implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-fvi
Plan-reviewed: 3eeb2bdd (code-review, pr-review)
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
+barwise/scripts/tests/vitest-tmp.test.mjs,
+barwise/scripts/tests/fixtures/vitest-tmp/one.test.mjs,
barwise/scripts/tests/expected-counts.json,
barwise/knip.json

When a vitest run completes, it shall leave nothing behind in the temp
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

- When the lockfile is resolved, `vitest` and `@vitest/coverage-v8`
  shall resolve to 5.0.5, and every package shall declare both as
  `^5.0.5`. The floor names the first version with the fix, so a fresh
  resolve cannot pick a leaking one.
- When `npm run test:scripts` runs, `scripts/tests/vitest-tmp.test.mjs`
  shall run vitest on `scripts/tests/fixtures/vitest-tmp/`, with `TMPDIR`
  set to a new empty directory, and:
  - fail if vitest does not exit 0 with `1 passed`, because a run that
    never transformed a module would leave the directory empty without
    proving anything;
  - otherwise fail if the directory is not empty.
- The fixture is one test file that imports only `vitest` and `node:os`. It asserts that `os.tmpdir()` in the run equals the directory the test chose, so `1 passed` also proves the run used it. In CI and
  the pre-push gate, `test:scripts` runs before `npm run build`, so a
  file that imports a workspace package would fail there for want of
  `dist`. Prototype on 5.0.1: it runs in about 160 ms and leaves one
  `<id>/ssr/` folder.
- The test runs the workspace's own vitest, `barwise/node_modules/vitest/vitest.mjs`, which the lockfile pins, and its failure message names that version. The runner collects only `scripts/tests/*.test.mjs`, so the fixture under `fixtures/` is never run as a script test itself.
- The new file is added to `scripts/tests/expected-counts.json`
  (`npm run test:scripts -- --write`), or the runner refuses it.

Out of scope:

- Interrupted runs. 5.0.5 clears the folder only through `close()`.
  Its SIGINT and SIGTERM handler, and its teardown-timeout exit, end the
  process without closing, so Ctrl-C or a cancelled task still leaves a
  folder. That is far rarer than every completed run, and it is
  upstream's to fix.
- Removing folders an earlier version already leaked. They belong to the
  container, not the repository. A fresh session starts clean.
- Other vitest changes between 5.0.1 and 5.0.5. They are patch releases,
  and the full suite on the bumped lock is the check.

## Workstreams

### 1. Bump, and test that the temp directory stays empty

The changes above. Each item below is pinned or measured:

- The new test passes on 5.0.5.
- It fails on 5.0.1. The red check installs `vitest@5.0.1` and
  `@vitest/coverage-v8@5.0.1` together, with `--no-save` (the
  coverage plugin's peer dependency is exact), then restores with
  `npm ci`.
- The full monorepo suite and coverage pass on the bumped lock.

## Implementation notes

- As planned in the revised plan. The first draft ran a test file from
  `@barwise/learn`. The high plan review showed that this needs core's
  `dist`, which CI has not built when `test:scripts` runs, and that an
  empty directory alone could pass without vitest having run. The test
  now runs a build-free fixture and requires vitest to pass first.
- npm resolves 5.0.5 with its own dependencies moved to match: vite
  8.3.4 to 8.3.5, rolldown 1.2.14 to 1.2.15, chai, magic-string, obug,
  std-env, tinybench, tinyrainbow, why-is-node-running, postcss. These
  come from `npm install` and `npm update` alike, and they are kept as
  the tooling resolved them rather than edited by hand.
- Red check: with `vitest@5.0.1` and `@vitest/coverage-v8@5.0.1`
  installed `--no-save`, the test fails with "vitest 5.0.1 left these in
  its temp directory". After `npm ci` restores 5.0.5, it passes.

- `knip.json` ignores `scripts/tests/fixtures/**`. The fixture imports
  `vitest`, which the root workspace does not declare, so knip reported
  it as an unlisted dependency. The fixture is data that vitest runs, not
  code of the root workspace.

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
2. **What the test runs.**
   - (a) A fixture that imports only `vitest` (recommended). It needs no
     build, so it runs where `test:scripts` runs, before `npm run
     build`.
   - (b) A real package test file, such as one of `@barwise/learn`'s. That
     needs core's `dist`, which CI has not built yet at that point.

   Recommend (a).

## Risks and testing

A patch upgrade can change test behaviour. The full suite and the
coverage floors on the new lock are the check, through the pre-push gate
and CI.
