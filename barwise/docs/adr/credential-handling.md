# Credential handling

Scope: process
Date: 2026-09-12
Tracking: barwise-ubc, barwise-1021, barwise-1022, barwise-1028, barwise-3wu, barwise-i23,
barwise-jha, barwise-8fc, barwise-flw, barwise-sma,
docs/specs/credential-scanning.spec.md,
docs/specs/credential-handling-held.spec.md
Enforced-by: tests (gitleaks-detects, scan-index-and-history, wrapper-contract,
pinned-gitleaks)

## Context

Every other gate in `ci.yml` guards a defect a follow-up commit can fix. A
committed credential is not one: reverting, deleting the branch and
rewriting history all leave the key valid and already disclosed.
`.gitignore` covering `.env` stood in for a gate and could not see the
three paths a secret actually arrives by here -- machine-written tracked
files under `eval-payloads/` and `eval-runs/`, commands pasted into
documentation, and fixtures imitating real payloads. Why detection is
delegated, why the wrapper exists, and the rejected alternatives are in `credential-scanning.spec.md`; removing the
places a key can be written down is `docs/adr/keyless-model-access.md`,
and the exit contract `credential-handling.md#wrapper-contract` applies is
`docs/adr/gate-refusal-contract.md`.

## Decision

1. **Detection is gitleaks', not ours.**{#gitleaks-detects} No rules are added here:
   `.gitleaks.toml` is `[extend] useDefault = true` plus exactly one rule,
   for Anthropic keys, which gitleaks 8.28.0 does not detect.
2. **Scan the index at the commit and all reachable history in CI.**{#scan-index-and-history}
   `npm run check:secrets -- --staged` runs at the pre-commit hook;
   `npm run check:secrets` scans all reachable commits in CI with no
   docs-only skip.
3. **The wrapper supplies the gate contract, not detection.**{#wrapper-contract}
   `scripts/check-secrets.mjs` exits `2`, never reporting a clean scan,
   when gitleaks is absent or cannot be executed, when `.gitleaks.toml` is
   absent, when a history scan is asked of a shallow clone, when the
   repository root cannot be resolved, or when gitleaks exits anything but
   0 or 1. It always passes `--redact` and `--verbose`, and on a finding
   exits `1` and says to rotate first.
4. **One pinned version, verified.**{#pinned-gitleaks} `scripts/install-gitleaks.sh` is the
   single home of the version and per-platform SHA-256, verified before
   unpacking, and is what both `ci.yml` and the session hook call.

## Consequences

- A real finding is remedied by rotating the key, which a person does in
  the provider console; this record prescribes nothing there. Reverting
  the commit, deleting the branch or rewriting history does not undo a
  leak -- the key stays valid and already disclosed -- though a revert may
  still be wanted to get the key out of the tree. The wrapper's finding
  message and the pre-commit hook's own line both say to rotate. This was
  decision 1 until 2026-11-06, retired as guidance no check can hold
  (`adr-refactor.spec.md`, row 2).
- CI runs on push and pull request to main. Its install step and its
  `npm run check:secrets` step carry no `if:`, so they run on docs-only
  changes too, but under GitHub's implicit `success()` they are skipped in
  a run where an earlier step (`fmt:check`, `check:beads` and others)
  already failed. The `fetch-depth: 0` checkout makes the history scan
  answerable.
- Pre-push runs `ci:local -- --commit` for each pushed commit, which
  derives `check:secrets` from `ci.yml` with no condition, so the history
  scan runs before each push. It uses whatever gitleaks is on PATH.
- The session hook runs only in remote sessions (`CLAUDE_CODE_REMOTE`).
  There it installs the pin and unshallows the clone, and either failing
  is non-fatal; but both come after an unguarded npm install and build
  under `set -euo pipefail`, so a failed build skips both, and the
  session's `check:secrets` then refuses. If the install fails while
  another gitleaks is on PATH, the gate runs with that one.
- What holds each decision. `scripts/tests/credential-handling.test.mjs`
  (`credential-handling-held.spec.md`) holds all four from tracked text
  and stand-ins, so it never skips for a missing gitleaks:
  - 1: it reads `.gitleaks.toml` as `[extend] useDefault = true` plus
    exactly one rule, `anthropic-api-key`. The `gates.test.mjs` probes,
    where gitleaks is installed, also show `useDefault` and the Anthropic
    rule detecting. barwise-1028 (open) tracks sending the rule upstream.
  - 2: it requires the one CI step running `check:secrets` to carry no
    `if:`, no `continue-on-error` and no `--staged`, after a
    `fetch-depth: 0` checkout, and the pre-commit hook to run
    `check-staged-secrets.sh || exit $?`, which scans `--staged` and
    passes its status through. The git hooks exist only
    after `npm run prepare` (`.npmrc` sets `ignore-scripts`), and not
    in a `git worktree` checkout (barwise-mdp); a clone without them
    commits and pushes with no local scan, and CI scans after the push. The `--staged` scan does not
    inspect untracked files or history, and a clean merge commit runs
    `pre-merge-commit`, which validates only the tracker; neither scan
    inspects unreachable objects (spec, Out of scope, for untracked files
    and unreachable objects).
  - 3: `scripts/tests/gates.test.mjs` shows the gate red on staged probes,
    asserts redaction on the secret itself, and covers gitleaks absent, an
    odd gitleaks status, a missing config and a shallow clone; it runs in
    CI under `npm run test:scripts` (`if:
    steps.changes.outputs.docs_only != 'true'`). The
    unresolvable-root refusal is covered by the git-failure cases
    (`ROOT_DEPENDENT_GATES`). The pre-commit hook's
    secrets step (`scripts/hooks/check-staged-secrets.sh`) tells a refusal
    from a finding: only exit 1 prints "ROTATE it", and a refusal says
    nothing was scanned (barwise-jha, fixed in gate-contract-enforced WS4). `ci:local` names a refusal
    as "could not answer" separately from failures in every run. The
    exec-error refusal (gitleaks present but failing to spawn) and the
    argv (`--redact`, `--verbose`, `--no-banner`, `--config`) are
    tested against a stand-in in `credential-handling.test.mjs`.
  - 4: `credential-handling.test.mjs` fails when `ci.yml` or the session
    hook mentions gitleaks other than as the installer's name or a step
    name (so a `uses:` action, `go install` or a package manager fails
    unnamed), and runs the installer against a download no digest
    matches to show it stops before `tar`. Other workflows are not read.
- Left open in the spec, not decided here (its Open decisions carry
  recommendations, none marked resolved; the first, keeping the local
  Anthropic rule, is settled by CLAUDE.md, which `credential-handling.md#gitleaks-detects` follows):
  - whether the wrapper should refuse a gitleaks other than the pin; today
    it prints the version (barwise-8fc);
  - whether `.gitleaksignore` entries are checked for staleness; no such
    file exists yet (barwise-flw);
  - whether GitHub push protection is enabled. The spec calls it "not
    assertable from this tree". Until then a commit reaches the remote
    before any scan when the hooks are absent (above) or skipped with
    `--no-verify`, the documented escape hatch for work in progress
    (barwise-sma).
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5),
  `credential-scanning.spec.md`, the
  headers of `check-secrets.mjs`, `.gitleaks.toml` and
  `install-gitleaks.sh`, the comments on the `ci.yml` secret-scan steps,
  the pre-commit hook, `.claude/hooks/session-start.sh`, and the
  check-secrets section of `scripts/tests/gates.test.mjs` also state this
  rule.
