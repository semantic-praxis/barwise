# Web sessions run the Node that `.nvmrc` pins

Status: Implemented -- single workstream, landed with this spec

Created: 2026-09-25
Last-updated: 2026-09-25
Tracking: barwise-1059

The session-start hook installs and selects the Node version in `.nvmrc`
before it runs `npm install`, and carries that choice into the rest of the
session. Until now it used whatever Node the container image put first on
the PATH -- Node 22 with npm 10.9.7 -- while CI reads `.nvmrc` (26.7.0,
npm 11). The mismatch had two effects, one visible and one not.

## Principle

**Explicit over implicit.** `.nvmrc` is the declared runtime, and
`CLAUDE.md` already says why it is pinned: v8 coverage thresholds are not
portable across Node versions, so "a floating runtime means the gate passes
or fails by whichever Node you happen to have." CI honoured the pin. The one
environment that did not was the web session, which inherited its Node from
the container image by accident, not by declaration.

## What went wrong (measured 2026-09-25)

- **Visible: the lockfile rewrite.** npm 10.9.7 drops the `libc` fields
  that npm 11 wrote into `barwise/package-lock.json` (10 entries, 30 lines).
  The hook runs `npm install` on every start AND every resume, so each
  session and each scheduled check-in dirtied the tree, and the stop hook
  asked for a commit that would have degraded the lock. Reverted by hand
  about ten times in one session.
- **Invisible: local gates ran on the wrong Node.** Every `npm run
  ci:local` in a web session -- the pre-push hook -- ran on Node 22. Its
  "all gates passed" was therefore not the same claim CI makes, on exactly
  the gate (`test:coverage`) the Node pin exists for.

Verified before the change: with Node 26.7.0 first on the PATH, `npm
install` reports "up to date" and leaves the lockfile byte-identical.

## Design

In `.claude/hooks/session-start.sh`, before `npm install`:

1. Read the wanted version from `.nvmrc`. It is never copied into the hook,
   so the pin keeps one home.
2. If `${NVM_DIR}/versions/node/v<version>/bin/node` is absent, run `nvm
   install <version>` in a child `bash`. The container image ships nvm at
   `/opt/nvm`; `nvm install` verifies the download against the release's
   `SHASUMS256.txt`. Measured: 6.8 s on a cold container, skipped on
   resume.
3. Prepend that `bin` to `PATH` for the rest of the hook, and append the
   same export to `CLAUDE_ENV_FILE`, the mechanism the hook already uses for
   `~/.local/bin`, so later commands and the git hooks inherit it.
4. Read back `node --version`. If it is not the pinned version, print a
   loud warning naming both consequences (lockfile rewrite, gates on the
   wrong Node) and continue.

## Should a failed Node install stop the session? (resolved: no)

The hook's existing rule for tool installs (lines on shellcheck and
gitleaks) is that a session that starts degraded and says so beats a
session that cannot start. The same applies here: a `nodejs.org` outage
should not cost a whole session. The warning is the refusal half of the
gate contract (`docs/specs/gate-refusal-contract.spec.md`): it never
reports the pin as satisfied when it is not.

## Alternatives considered

- **`npm ci` instead of `npm install`.** Never writes the lockfile, so it
  removes the visible symptom. Rejected as the fix because it leaves the
  gates on the wrong Node, and it reinstalls `node_modules` on every resume.
- **Restore the lockfile after install.** Hides the symptom; fixes neither
  effect.
- **Pin a Node digest in the repo, as `install-gitleaks.sh` does.** Would
  give the version a second home that must agree with `.nvmrc`. nvm's
  checksum check against the release's own manifest is sufficient here.
- **Change the environment's setup script in claude.ai.** Works, but lives
  outside the repository, so it is neither reviewed nor versioned with the
  pin it serves.

## Risks and testing

- **nvm absent** (a different base image): the hook warns and continues on
  the image's Node, the old behaviour, loudly.
- **Native modules built under another Node:** none; `.npmrc` sets
  `ignore-scripts=true`, so nothing compiles on install.
- Verified by running the hook by hand in a container on Node 22: it
  installs 26.7.0, `npm install` leaves the lockfile unchanged, and
  `CLAUDE_ENV_FILE` gains the Node `bin` export. `npm run check:shell`
  lints the hook.
- Takes effect for sessions that start after merge; the session that wrote
  this spec keeps Node 22.

## Implementation notes

- **nvm failed silently twice in the first draft.** `bash -c 'source
  nvm.sh && nvm install "$1"' _ <version>` exited 3 with no output. Sourcing
  `nvm.sh` returns 3 when no default Node is installed yet, so the `&&`
  never ran the install; and `source` hands the caller's positional
  arguments to `nvm.sh`, which reads them as its own. `source nvm.sh
  --no-use` fixes both. The hook's read-back is what surfaced it: the first
  hand run printed the "running Node v22.22.2" warning instead of passing.
- Measured by running the hook by hand with Node 22 first on the PATH: a
  cold start (Node 26 and nvm's download cache removed) took 9.8 s total,
  with the checksum matched and the lockfile byte-identical afterwards; a
  resume took 2.2 s, printed nothing, and did not reinstall.

## Non-goals

- No change to CI, which already reads `.nvmrc`.
- barwise-1033 (stale remote-tracking refs) is deliberately left as is; the
  requester deferred it on 2026-09-25 until it proves a real cost.
