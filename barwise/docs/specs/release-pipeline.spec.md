# Release pipeline: downloadable CLI and MCP alongside the VSIX

Status: Draft for review (design only -- no implementation in this PR)
Tracking: follows REPO_REVIEW-2026-06.md finding #5 (MCP publishing
story; resolved as "stay private"). Distribution and artifact set
decided in review (see "Decided").

## Principle

One `@barwise/core` powers three entry points -- the CLI, the MCP
server, and the VS Code extension -- but a release surfaces only the
extension. That under-serves the composability the architecture is built
on: a user who wants the terminal or AI-agent workflow has nothing to
download. The release should expose all three entry points, and name its
artifacts explicitly in the workflow (explicit over implicit) rather than
leaving the CLI and MCP undeliverable.

The gap is also overdue in practice: v1.5.0 is the latest tag and main
carries 158 commits past it, so today's "latest release" is stale.

## Decided (in review)

- **Distribution: GitHub release assets.** Artifacts attach to each
  published release; users download from the release page. This keeps
  every package private (finding #5) -- no npm publish, no `NPM_TOKEN`.
- **Artifacts: VSIX + CLI bundle + MCP bundle + SHA-256 checksums.** No
  standalone (Node SEA) executables -- the audience runs Node, and a
  per-OS binary matrix is not worth its weight yet.
- **Two triggers.** `release: published` builds and attaches assets to
  an intentional, versioned release (unchanged). A push to `main` also
  rebuilds the assets and updates a single moving `edge` pre-release, so
  a current download always exists without minting a version tag per
  merge. Semver releases stay intentional; `edge` is explicitly
  pre-release.

## Scope

In scope: an esbuild bundle for `@barwise/cli` (it has none today);
expanding `release-vsix.yml` into a `release.yml` that builds and
attaches the VSIX, the CLI bundle, the MCP bundle, and a checksums file
to a published release; a rolling `edge` pre-release rebuilt on every push
to `main`; exercising the CLI bundle in regular CI; cutting the overdue
release.

Out of scope: npm publishing (finding #5 stands); standalone executables;
_automatic version bumps_ -- the rolling build uses one moving `edge`
tag, not a new semver tag per merge, and the documented manual
`npm version` + tag flow stays for real releases; Homebrew/winget/other
channels.

## Inventory

| Artifact                    | Today                            | Needed                             |
| --------------------------- | -------------------------------- | ---------------------------------- |
| VS Code extension (`.vsix`) | built by release-vsix.yml        | keep; rename workflow              |
| CLI (`barwise`)             | tsc only -- needs workspace deps | add esbuild bundle (mirror MCP)    |
| MCP server (`barwise-mcp`)  | esbuild bundle exists            | attach the bundle to the release   |
| SHA-256 checksums           | none                             | generate over all attached assets  |
| Trigger                     | `release: published`             | unchanged (release is intentional) |

The CLI is the only real build gap. `@barwise/mcp` already esbuild-bundles
to a self-contained `dist/bundle/index.cjs` with a `#!/usr/bin/env node`
banner; the CLI is a plain `tsc` build whose `dist/index.js` imports
`@barwise/core` and the other workspace packages, so it cannot run
detached from the monorepo. The fix is the same ~25-line `esbuild.mjs`
MCP uses.

## Target architecture

```
packages/cli/
  esbuild.mjs            NEW: bundle src -> dist/bundle/index.cjs
                         (mirror packages/mcp/esbuild.mjs: platform node,
                          format cjs, shebang banner, external web-worker)
  src/bundle-entry.ts    NEW: shebang-free entry that runs createProgram
                         (index.ts keeps its own shebang for tsc builds)
  package.json           add "bundle": "node esbuild.mjs"

.github/workflows/
  release.yml            renamed from release-vsix.yml
    on: release:published   (versioned release)
        push: [main]        (rolling edge build)
    concurrency: cancel in-progress edge builds on rapid merges
    build (npm ci + npm run build)
    package VSIX  (vsce, as today)
    bundle CLI    (npm run --workspace=@barwise/cli bundle)
    bundle MCP    (npm run --workspace=@barwise/mcp bundle)
    stage assets + SHA256SUMS
    if release:  upload to that release's tag
    if push:     move the `edge` tag to HEAD, recreate the `edge`
                 pre-release, upload assets (clobbering)

ci.yml
    add "bundle CLI" next to the existing "bundle MCP" step, so the
    release-time bundle is exercised on every PR, not only at release
```

Versioned-release assets are named `barwise-cli-<ver>.cjs` /
`barwise-mcp-<ver>.cjs`; the moving `edge` release uses stable
`barwise-cli-edge.cjs` / `barwise-mcp-edge.cjs` names (clobbered each
push), with the source commit recorded in the release body.

The CLI and MCP bundles ship as raw `.cjs` files: they carry the
`#!/usr/bin/env node` shebang, so `chmod +x barwise-<ver>.cjs &&
./barwise-<ver>.cjs validate model.orm.yaml` works, as does
`node barwise-<ver>.cjs ...` with no install.

## Workstreams (each independently shippable)

### 1. CLI esbuild bundle

Add `packages/cli/esbuild.mjs`, `src/bundle-entry.ts`, and the `bundle`
script, mirroring `@barwise/mcp`. Add a `bundle CLI` step to `ci.yml`
beside the MCP one and a smoke test that runs the bundled CLI
(`node dist/bundle/index.cjs --version`) so the artifact is proven on
every PR. Lands first: it is the missing build, independent of the
workflow change, and the release step depends on it.

### 2. Expand the release workflow (versioned)

Rename `release-vsix.yml` to `release.yml`; after the build, package the
VSIX (unchanged), produce the CLI and MCP bundles, stage them under
versioned names, generate `SHA256SUMS`, and `gh release upload` all of
them to the published release. Depends on workstream 1 for the CLI bundle
script.

### 3. Rolling edge pre-release

Add the `push: [main]` trigger and a concurrency group that cancels an
in-progress edge build when a newer merge lands. The build is shared with
workstream 2; the upload branches on `github.event_name`: on a push,
move the `edge` tag to `HEAD`, recreate the `edge` pre-release (so stale
assets are dropped), and upload the `-edge` assets and checksums. The
release body notes the source commit and that `edge` is an unstable build
from the latest `main`. Depends on workstream 2.

### 4. Cut the overdue release

Follow the documented flow: `npm version minor` across the workspace
(features have landed since v1.5.0, so 1.6.0), commit, tag, push, and
create the GitHub release with `--generate-notes`. The new `release.yml`
then attaches all four asset kinds. This is the act that produces the
downloadable build; it is a maintainer step, listed here for sequencing.

## Risks and testing

- The versioned-release path only runs on a real `release: published`
  event, so it cannot be fully dry-run on a PR. Mitigation: workstream 1
  moves the risky part (the CLI bundle build) into regular CI, where it
  runs and is smoke-tested on every push; and the rolling edge build
  exercises the _entire_ workflow (build, bundle, stage, checksums,
  upload) on every merge to main, so the versioned path is essentially
  the same code on a different upload target.
- Rapid merges could overlap edge builds; the concurrency group cancels
  the older run so the `edge` assets always reflect the newest `main`.
  The edge build adds one artifact build per merge -- acceptable, and
  bounded by cancel-in-progress.
- Bundle parity: the CLI pulls the same dependency set as the MCP server
  (core, diagram, llm, code-analysis, dbt, formats, plus elkjs/yaml/ajv),
  which already bundles cleanly, so no new native-module surprises are
  expected. The smoke test catches a broken bundle.
- `--no-dependencies` VSIX packaging is unchanged.

## Open decisions (for review)

- **Asset naming.** Recommend `barwise-cli-<ver>.cjs`,
  `barwise-mcp-<ver>.cjs`, the vsce-default `barwise-vscode-<ver>.vsix`,
  and `SHA256SUMS`. Raw `.cjs` over a `.tgz` because it is directly
  runnable; a tarball adds an extract step for no gain here.
- **Version bump.** Recommend minor (1.6.0): the window since v1.5.0
  added the diagram-ui renderer, the DiagramSession contract, the
  connector migration, and CI features -- new capability, not just fixes.

## Non-goals

- No npm publishing; packages stay private (finding #5).
- No standalone per-OS executables.
- No change to the version-bump/tag flow documented in CLAUDE.md, the ORM
  notation, or any package's public API.
