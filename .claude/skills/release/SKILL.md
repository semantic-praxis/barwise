---
name: release
description: Use when cutting a barwise release - bumping the single monorepo version, tagging, and creating the GitHub release that builds the downloadable artifacts. Carries the bump-sequence gotchas (workspace dependency refs, SERVER_VERSION sync, tutorial regeneration) that make a naive npm version fail CI.
---

# Cutting a Barwise Release

The project uses a single version number across all packages, tracked
by git tags on the main branch. Versions follow semver. Changes
accumulate on main; a release is an intentional act, not automatic.

1. **Develop** -- merge PRs to main. CI runs build + test + lint.
2. **Decide to release** -- when a meaningful set of changes has landed.
3. **Bump versions** -- update package.json files in a PR, then tag its
   merge commit (below).
4. **Create a GitHub release** -- triggers the artifact build workflow.

To review what changed since the last release:

```bash
git log --oneline v1.2.0..HEAD
```

## Bump versions and tag

The bump is a pull request like any other change, and the tag goes on
the merge commit once it lands. AGENTS.md forbids committing to main,
and v1.7.0 was cut this way (PR #279, tagged on its merge commit); this
section used to push the bump and the tag straight to main, which is
the one path that skips CI on the commit being released (barwise-8e4).

All commands run from `barwise/`. The `--no-workspaces-update` flag
prevents npm from resolving workspace dependencies against the public
registry (these packages are not published). Use `patch` for bug fixes
and small improvements, `minor` for new features or format support:

```bash
git fetch origin main   # a stale origin/main would bump from a version already shipped
git checkout -b release-bump origin/main
npm version patch --workspaces --include-workspace-root \
  --no-git-tag-version --no-workspaces-update
VER=$(node -p "require('./package.json').version")
# before committing: the three gotchas below, and the release-notes
# rename under "Create a GitHub release"
git add -A && git commit -m "bump to $VER"
git push -u origin release-bump   # open the PR; merge it once CI is green
```

After the PR merges, tag the merge commit, not the branch commit. This
block stands alone: it reads the version from the commit it tags rather
than from `VER` above, which is empty in a fresh shell and would make the
tag a bare `v`.

```bash
git fetch origin main
SHA=$(git rev-parse origin/main)   # or the bump PR's merge SHA, if something merged after it
git log -1 "$SHA"                  # confirm it is the bump's merge commit
VER=$(git show "$SHA:barwise/package.json" | node -p "JSON.parse(require('fs').readFileSync(0)).version")
git tag -a "v$VER" -m "v$VER: brief description" "$SHA"
git push origin "v$VER"
```

Three gotchas, each of which fails CI if skipped:

- `--no-workspaces-update` leaves each package's internal `@barwise/*`
  dependency refs at the previous version. Bump those to the new
  version too (a one-pass rewrite of the `@barwise/*` entries in every
  `packages/*/package.json`), then run `npm install` to refresh the
  lockfile -- otherwise `npm ci` fails trying to fetch the old version
  from the registry.
- Bump the pinned `SERVER_VERSION` in `packages/mcp/src/server.ts`; a
  version-sync test asserts it matches package.json.
- Run `npm run regen:tutorial`: the committed tutorial Markdown stamps
  the tool version, and its drift test fails until regenerated.

The `barwise-vscode` extension has its own version (visible in the VS
Code marketplace) which may differ from the library packages. The
`npm version` command bumps each package relative to its current
version, so they stay in sync if they start in sync.

## Create a GitHub release

```bash
gh release create v1.3.0 --title "v1.3.0" --generate-notes
```

`--generate-notes` builds the changelog from merged PRs since the last
tag. A PR list does not tell a user what to do about a breaking change,
so changes that need explanation are written ahead of time in
`barwise/docs/release-notes/unreleased.md`. If that file exists, rename
it to `<version>.md` in the bump commit and add
`--notes-file barwise/docs/release-notes/<version>.md`; gh combines it
with the generated changelog. Check that `gh` is on PATH first; the GitHub MCP tools can read
releases but not create one. The `release.yml` workflow then builds and attaches
the artifacts: the VS Code extension (`.vsix`), the standalone CLI
bundle (`barwise-cli-<ver>.cjs`), the MCP server bundle
(`barwise-mcp-<ver>.cjs`), and a `SHA256SUMS` file. The same workflow
refreshes a rolling `edge` pre-release on every push to `main`, so a
current download always exists between tagged releases.

**The `edge` tag moves on every build, so run this once per clone:**

```
git config --add remote.origin.fetch '+refs/tags/*:refs/tags/*'
```

Without it, a plain `git pull` is fine -- measured: it exits 0 and
updates `main`, because auto-tag-following adds tags that are absent
locally and skips one that already exists. But an explicit `git fetch
--tags` is rejected with "would clobber existing tag" and exits 1. The
config line makes tag updates forced, which is what a moving tag needs.

Do NOT reach for `fetch.pruneTags` instead. It was measured to make even
a plain `git pull` fail, which is worse than the problem it is being
asked to solve.

The tag was frozen between 2026-06-14 and 2026-09-22 for the opposite
reason, and the cost of freezing it was a releases page that filed
`edge` below three versioned releases under a date six weeks older than
its own assets -- read, correctly, as the build having stopped.
`barwise/docs/specs/edge-release-currency.spec.md` carries the
measurements both ways.

## Minor releases: run the Phase A architecture review

A minor release is the cadence point for the deep assessment in
`barwise/docs/specs/archive/architecture-analysis.spec.md`: walk the scenario
catalog in `docs/architecture-scenarios.md`, refresh the reflexion and
hotspot snapshot via `npm run arch:triage -- --base <last-release-tag>`
(so the ranking covers only the changes since that release), and
commit a new dated `docs/REPO_REVIEW-<YYYY-MM-DD>.md`. The continuous
fitness functions (`npm run depcruise`, `npm run purity`) guard the
structural pillars between releases; this review covers the judgment
calls they cannot.
