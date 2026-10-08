# check:lockfile tells a stale install from a range problem

Status: Implemented 2026-10-08 (single change). One deviation from the draft: the comparison skips every entry outside `node_modules`, not only the root (see Scope).
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-2d4

## Principle

A gate that cannot see its input must not print PASS, and must not print
FAIL either (`gate-refusal-contract.spec.md`). `check:lockfile` asks
whether the versions the lockfile resolved satisfy every workspace's
declared ranges. It answers by reading the installed tree with `npm ls`,
which is a faithful stand-in for the lockfile only when the tree was
installed from that lockfile. In CI it always was: CI runs `npm ci` first.
Locally it often was not, and then the gate answers a question about an
old install while reporting it as a question about the lockfile.

## What happens today (measured 2026-10-08)

On 2026-10-08 the pre-push hook failed this gate on a branch that had
merged main. The local tree still held `@anthropic-ai/sdk@0.127.0` and
`@modelcontextprotocol/sdk@1.30.0`. Main's lockfile and manifests had
moved on and agreed with each other. The gate printed "The lockfile
resolved a version some package.json does not accept ... Fix the ranges
and reinstall." The ranges were fine; `npm ci` fixed it.

Probed with a one-dependency fixture declaring `foo@^2.0.0` and a lockfile
resolving `foo@2.2.0`:

| On disk     | `npm ls`               | Gate today                | Truth                                                      |
| ----------- | ---------------------- | ------------------------- | ---------------------------------------------------------- |
| `foo@1.0.0` | exit 1, `invalid: foo` | exit 1, blames the ranges | install is stale                                           |
| `foo@2.1.0` | exit 0, no problems    | exit 0, OK                | install is stale; the lockfile's `2.2.0` was never checked |
| `foo@2.2.0` | exit 0, no problems    | exit 0, OK                | OK                                                         |

The second row is the worse one: a false green on a tree the lockfile does
not describe. The first row is the one barwise-2d4 reported.

## Scope

- Before running `npm ls`, the gate shall compare each entry in
  `package-lock.json`'s `packages` map with the installed package at that
  path, reading the installed `package.json`'s `version`.
- When an installed version differs from the lockfile's version, or a
  non-optional lockfile entry has nothing installed at its path, the gate
  shall exit 2, list the first differences (lockfile version against
  installed version, by path), and name `npm ci` as the remedy.
- The comparison shall skip entries whose path is outside `node_modules`
  (the root and the workspaces), `link: true` entries (workspace
  symlinks), and entries marked `optional` or `devOptional` that have
  nothing installed. The draft skipped only the root; mutation testing
  showed that skip was untested, and the reason it matters covers the
  workspaces too: their entries describe source manifests, so a version
  bump not yet followed by `npm install` would read as a stale install
  and `npm ci` is not the remedy. On this tree, 131 of 685 entries are
  optional platform builds absent by design; none are required and
  missing, and no installed version differs after `npm ci`.
- When `package-lock.json` is absent, the gate shall skip the comparison
  and behave as today. The gate's question is about the installed tree
  against the manifests, and the test fixtures have no lockfile.
- When `package-lock.json` is present but has no `packages` map
  (lockfileVersion 1, or a bad merge), the gate shall exit 2 rather than
  skip the comparison, which would bring back the false green.
- When an installed package is a symlink the lockfile does not mark as a
  link (`npm link` to a local checkout), the gate shall skip it. The
  developer put it there on purpose, and `npm ci` would undo it; `npm ls`
  still checks its version against the range.

The last two rules and the neutral wording of the refusal ("not installed
from this lockfile", since an install can be newer than the lockfile as
well as older) came from the self-review.

- The range-problem message (exit 1) is unchanged, because once the
  comparison passes, a range problem is a range problem.

Out of scope:

- Packages installed but absent from the lockfile (extraneous). `npm ls`
  already reports them; `npm ci` removes them. Detecting them would mean
  walking every `node_modules` directory rather than reading the lockfile.
- Running `npm ci` automatically. The gate reports; installing is the
  operator's call, and a hook that rewrites `node_modules` mid-push would
  surprise anyone with a linked local package.

## Inventory

| Module                                      | Change                                           |
| ------------------------------------------- | ------------------------------------------------ |
| `barwise/scripts/check-lockfile-agrees.mjs` | Lockfile-against-disk comparison before `npm ls` |
| `barwise/scripts/tests/gates.test.mjs`      | Fixtures for both stale rows and the skips       |

`ci-local.mjs` already reports an exit 2 as REFUSED with the gate's
output, so the pre-push hook still stops the push and now shows the right
remedy. `ci.yml` needs no change: after `npm ci` the comparison is clean
by construction.

## Alternatives considered

- **Read `node_modules/.package-lock.json`** (npm's hidden lockfile)
  instead of each installed `package.json`. One file read instead of about
  700, but it is npm's own record of what it installed, not the installed
  files. It is the same kind of stand-in this spec removes. The per-file
  read costs milliseconds.
- **Reword the exit-1 message to mention `npm ci`.** One line, and it
  fixes the first row's wording. It leaves the second row's false green,
  and it would tell someone with a real range problem to reinstall, which
  does nothing for them.
- **Exit 1 for a stale install.** A stale install is not a finding about
  the repository; CI cannot hit it. Exit 2 keeps "this tree has a problem"
  distinct from "this container cannot check it", as the refusal contract
  defines.

## Workstreams

One change: the comparison, its refusal, and the fixture tests land
together.

## Risks and testing

- Each rule gets a fixture test, and each is checked by undoing it and
  confirming a test fails: a differing version (both rows of the table),
  a missing required entry, a missing optional entry (passes), a link
  entry (skipped), a root entry ahead of the lockfile (skipped), and an
  absent lockfile (today's behavior).
- The existing three tests keep passing unchanged.
- `npm run fault-matrix` covers the gate's dependence on `git`; the new
  reads touch only the filesystem.
