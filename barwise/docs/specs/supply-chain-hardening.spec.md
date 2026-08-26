# Supply-chain hardening: block install-time scripts, make the audit gate blocking

Status: Implemented (WS1-WS4 landed with this spec)
Created: 2026-08-26
Last-updated: 2026-08-26
Tracking: `.github/workflows/ci.yml` carried the intent inline -- "Tighten
to a blocking step once the backlog is cleared" -- against a
`continue-on-error` audit step. This spec clears the backlog and removes
the escape hatch.

## Principle

**Explicit over implicit**, applied to the dependency tree. Two
implicit behaviours were doing security-relevant work with nothing
declared:

Installing a dependency executed its `preinstall`/`install`/`postinstall`
scripts, so `npm ci` granted arbitrary code execution to all 707 lockfile
entries and to every future version any of them resolves to. Nothing in
the repository declared which packages needed that, and nothing would
have noticed a package that newly started wanting it.

The `npm audit` step ran with `continue-on-error: true`, so the build
reported green over 20 high and 2 critical advisories. A gate that cannot
fail is not a gate; it is a comment that costs CI time.

The second half also applies "define errors out of existence": rather
than asking every reader to know that the audit line is decorative, make
the step fail, and make the exceptions a declared, expiring list.

## Should we switch to pnpm instead? (resolved: no)

pnpm's security advantage over npm is almost entirely **defaults, not
architecture**: dependency lifecycle scripts are blocked unless
allowlisted (`onlyBuiltDependencies`), and `minimumReleaseAge` can refuse
versions published in the last N days. Both resolve from the same
registry with the same integrity hashes; pnpm vets nothing npm does not.

The first default -- the one that matters, because install-time script
execution is how the 2025 registry worms propagated -- is reproducible in
npm with one line of `.npmrc`. The second is not reproducible, and is the
only real reason to revisit pnpm later.

Against that, migrating costs `workspace:*` protocol rewrites across all
12 packages, Turborepo re-wiring, and a symlinked `node_modules` that the
vscode package's esbuild bundle and VSIX packaging have never run
against. That is a large, unverified change to the build for a benefit
one line already buys.

Resolution: stay on npm, take the default that matters. Revisit pnpm on
its own merits (install speed, disk, the cooldown window), not as a
security fix.

## Scope

In scope:

- When `npm install` or `npm ci` runs, the system shall not execute
  lifecycle scripts belonging to any dependency.
- When `npm run build` runs in `@barwise/cli`, the system shall make
  `dist/index.js` executable, without relying on a `postbuild` hook.
- When `npm run audit` runs and any advisory of severity `high` or
  `critical` affects the dependency tree, the system shall exit non-zero
  unless that advisory appears in the declared exception list with an
  unexpired date.
- When an exception's `expires` date has passed, the system shall exit
  non-zero regardless of the advisory's severity.
- When CI runs on a non-docs change, the audit gate shall run without
  `continue-on-error`.

Out of scope: pnpm migration; `minimumReleaseAge`-style install
cooldowns (no npm equivalent); registry-side controls (trusted
publishing, token policy); moving `@vscode/test-cli` off mocha.

## Inventory

| File                                  | Current state                                              | Verdict                                     |
| ------------------------------------- | ---------------------------------------------------------- | ------------------------------------------- |
| `barwise/.npmrc`                      | does not exist                                             | new: `ignore-scripts=true`                  |
| `packages/cli/package.json`           | `postbuild: node scripts/chmod-bin.mjs`                    | fold into `build` -- the hook stops running |
| `packages/vscode/package.json`        | `pretest:integration: tsc -p tsconfig.test.json`           | fold into `test:integration` -- same class  |
| `packages/mcp/package.json`           | `prepublishOnly: node esbuild.mjs`                         | left alone; see Risks                       |
| root `package.json`                   | `prepare: cd .. && husky barwise/.husky`                   | stays, but no longer runs on install        |
| `barwise/scripts/audit-gate.mjs`      | does not exist                                             | new: the gate                               |
| `.github/workflows/ci.yml`            | `npm audit --audit-level=high` + `continue-on-error: true` | becomes `npm run audit`, no escape hatch    |
| `packages/*/package.json` (vitest)    | `^3.0.0` / `^3.2.4`, resolving 3.2.4                       | floor raised to `^3.2.7`                    |
| `packages/{cli,mcp,vscode}` (esbuild) | `^0.27.3`, resolving 0.27.7                                | raised to `^0.28.2`                         |

`dprint` and `esbuild` are the only two installed packages that declare a
real install-time script (`postinstall`), and both were verified to work
with it suppressed -- each resolves its platform binary through an
optional dependency, and the script is an optimization, not a
requirement. The other 57 lifecycle scripts in the tree are `prepare`,
which npm runs only for git-sourced dependencies; there are none. So no
rebuild allowlist is needed, and none is added.

## Target architecture

```
barwise/.npmrc                 ignore-scripts=true
                               |
                               v
npm ci  ---------------------> no dependency code executes at install
                               |
                               +-- esbuild:  binary via @esbuild/<platform>   (verified)
                               +-- dprint:   binary via @dprint/<platform>    (verified)

barwise/scripts/audit-gate.mjs
  npm audit --json
    -> advisories at severity >= high
       -> matched by an unexpired entry in ACCEPTED  -> reported, not fatal
       -> everything else                            -> exit 1
    -> any ACCEPTED entry past its expires date      -> exit 1
    -> any ACCEPTED entry matching nothing           -> warned, not fatal

.github/workflows/ci.yml
  - run: npm run audit          # no continue-on-error
```

The asymmetry in the last two rules is deliberate. An expired exception
must fail, or the list becomes permanent. A stale exception must not
fail, because it goes stale exactly when upstream ships the fix -- and
turning someone else's good news into a red build teaches people to
distrust the gate.

## Alternatives considered

- **`npm audit --omit=dev` as the blocking gate.** Would pass today
  without any exception list, since the whole remaining backlog is dev
  dependencies. Rejected: a compromised dev dependency runs on developer
  machines and in CI with repository credentials, which is the threat
  model that motivated this spec. Scoping the gate to production
  dependencies would exclude precisely the packages most worth gating.

- **`overrides` to force fixed transitive versions.** Would clear the
  last high advisory (`serialize-javascript`) without an exception entry.
  Rejected: mocha declares `serialize-javascript@^6.0.2` and `diff@^7.0.0`,
  and the fixed releases are 7.1.0 and 8.0.3 -- both majors outside the
  declared range. Forcing an unverifiable major on a test runner that CI
  never executes is gaming the scanner, not fixing anything.

- **A per-package rebuild allowlist** mirroring pnpm's
  `onlyBuiltDependencies`. Rejected as unnecessary once `dprint` and
  `esbuild` were verified to work without their `postinstall`. Adding an
  allowlist with nothing in it is an interface to maintain that removes
  nothing to think about.

## Workstreams

The four are ordered smallest-blast-radius first but land together: WS1
breaks the CLI bin without WS2, and WS4 fails the build without WS3.

### 1. Raise the dependency floors

`vitest` and `@vitest/coverage-v8` to `^3.2.7` across all 12 packages
(the two pin each other by exact peer dependency, so they move together);
`esbuild` to `^0.28.2` in `cli`, `mcp`, `vscode`; `npm audit fix` for the
non-breaking remainder. Clears 28 of 32 advisories, including both
criticals.

### 2. Block install scripts, repair what depended on them

Add `barwise/.npmrc`. Fold `chmod-bin.mjs` into the cli `build` script
and `tsc -p tsconfig.test.json` into vscode's `test:integration`.

The cli fold is not cosmetic. `ignore-scripts=true` suppresses `pre`/`post`
hooks for `npm run` as well as install lifecycle scripts -- `npm run build`
still runs `build`, but `postbuild` silently does not. Left unfolded, this
reintroduces barwise-807 exactly: `dist/index.js` at mode 644 and `npx
barwise` failing with "Permission denied". Verified by observation, not
inference -- a clean build under the new `.npmrc` produced mode 644.

### 3. The audit gate

`barwise/scripts/audit-gate.mjs` plus an `audit` npm script, with the
`@vscode/test-cli` -> mocha -> `serialize-javascript` cluster as the sole
declared exception.

### 4. Remove the escape hatch

`.github/workflows/ci.yml`: `npm audit --audit-level=high` +
`continue-on-error: true` becomes `npm run audit`.

## API and migration impact

No package's public API changes; no `src/` file is touched.

The one contributor-visible change: **git hooks no longer install
themselves.** The root `prepare` script is how husky wires
`core.hooksPath`, and `prepare` is an install lifecycle script, so
`ignore-scripts=true` stops it. A fresh clone now needs `npm install &&
npm run prepare`. README's "Clone and install dependencies" step is
updated to say so. Existing clones already have `core.hooksPath` set and
are unaffected -- which is also why this is easy to miss in review.

## Open decisions (for review)

- **Should the gate's threshold be `high` or `moderate`?** Kept at
  `high`, matching the previous step. Moving to `moderate` would today
  add one advisory (`yaml`, stack overflow on deeply nested collections)
  and would make the gate meaningfully noisier for a class of advisory
  that is mostly DoS-on-untrusted-input in tooling that reads our own
  files. Recommend keeping `high`; revisit if the exception list stays
  empty for a few months.

- **Should an exception require an issue reference?** Currently each
  carries `reason` and `expires` as free text. Requiring a `bd` issue id
  would tie expiry to tracked work rather than to a date someone picked.
  Recommend adding it when the list first exceeds one entry -- `bd` was
  not available in the container this landed from, so the follow-ups
  below are recorded here rather than filed.

## Risks and testing

- **`prepublishOnly` in `@barwise/mcp` no longer runs.** Nothing in the
  repository runs `npm publish` -- releases ship GitHub assets built by
  explicit `npm run --workspace=@barwise/mcp bundle` steps -- so this is
  latent, not live. It becomes live the day someone publishes to npm, and
  it would publish a package with no bundle. Follow-up: either drop the
  hook in favour of the explicit bundle step, or fold it as WS2 folded
  the others.

- **The exception list masks a real high advisory.** The
  `serialize-javascript` RCE is reachable only through mocha, which only
  `@vscode/test-cli` uses, which only `test:integration` runs, which CI
  does not run. The exception is dated so it cannot outlive that
  reasoning silently.

- **Verification performed:** clean `rm -rf node_modules && npm ci` under
  the new `.npmrc`; `npx esbuild --version` and `npx dprint --version`
  both resolve their binaries; full `npm run build` across all 12
  packages; full `npm run test`; `packages/cli/dist/index.js` confirmed
  at mode 755 after the folded build; `npm run audit` confirmed to exit 0
  with the exception present and non-zero with it removed.

## Non-goals

- No move to pnpm, and no change to how dependencies are resolved.
- No new capability on any surface; the capability matrix is untouched.
- No attempt to eliminate the remaining low and moderate advisories.
