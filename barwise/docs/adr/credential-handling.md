# Credential handling

Scope: process
Date: 2026-09-12
Tracking: barwise-ubc, barwise-1021, barwise-1022, barwise-1028, barwise-3wu, barwise-i23,
barwise-jha, barwise-8fc, barwise-flw, barwise-sma,
docs/specs/credential-scanning.spec.md,
docs/specs/gate-refusal-contract.spec.md

## Context

Every other gate in `ci.yml` guards a defect a follow-up commit can fix. A
committed credential is not one: reverting, deleting the branch and
rewriting history all leave the key valid and already disclosed.
`.gitignore` covering `.env` stood in for a gate and could not see the
three paths a secret actually arrives by here -- machine-written tracked
files under `eval-payloads/` and `eval-runs/`, commands pasted into
documentation, and fixtures imitating real payloads. The rule is stated in
the root `CLAUDE.md` conventions ("A leaked credential is rotated, never
reverted"). Why detection is delegated, why the wrapper exists, and the
rejected alternatives are in `credential-scanning.spec.md`; removing the
places a key can be written down is `docs/specs/keyless-model-access.spec.md`.

## Decision

1. **A leaked credential is rotated, never reverted.** The remedy for a
   real finding is rotation by a person in the provider console; history
   surgery is not a remedy and is never presented as one.
2. **Detection is gitleaks', not ours.** No rules are added here:
   `.gitleaks.toml` is `[extend] useDefault = true` plus exactly one rule,
   for Anthropic keys, which gitleaks 8.28.0 does not detect.
3. **Scan the index at the commit and all reachable history in CI.**
   `npm run check:secrets -- --staged` runs at the pre-commit hook;
   `npm run check:secrets` scans all reachable commits in CI with no
   docs-only skip.
4. **The wrapper supplies the gate contract, not detection.**
   `scripts/check-secrets.mjs` exits `2`, never reporting a clean scan,
   when gitleaks is absent or cannot be executed, when `.gitleaks.toml` is
   absent, when a history scan is asked of a shallow clone, when the
   repository root cannot be resolved, or when gitleaks exits anything but
   0 or 1. It always passes `--redact` and `--verbose`, and on a finding
   exits `1` and says to rotate first.
5. **One pinned version, verified.** `scripts/install-gitleaks.sh` is the
   single home of the version and per-platform SHA-256, verified before
   unpacking, and is what both `ci.yml` and the session hook call.

## Consequences

- CI runs on push and pull request to main. Its install step and its
  `npm run check:secrets` step carry no `if:`, so they run on docs-only
  changes too, but under GitHub's implicit `success()` they are skipped in
  a run where an earlier step (`fmt:check`, `check:beads` and others)
  already failed. The `fetch-depth: 0` checkout makes the history scan
  answerable.
- Pre-push runs `ci:local -- --commit` for each pushed commit, which
  derives `check:secrets` from `ci.yml` with no condition, so the history
  scan runs before each push. It uses whatever gitleaks is on PATH.
- The session hook runs only in remote sessions (`CLAUDE_CODE_REMOTE`),
  after the npm install and build; there it installs the pin and
  unshallows the clone, and either failing is non-fatal. If the install
  fails while another gitleaks is on PATH, the gate runs with that one.
- What holds each decision:
  - 1: no check is possible. The wrapper's finding message and the
    pre-commit hook's own line both say to rotate.
  - 2: nothing checks that `.gitleaks.toml` keeps `useDefault = true` and
    exactly one local rule; a second rule fails no test (barwise-3wu). barwise-1028
    (open) tracks sending the Anthropic rule upstream.
  - 3: the pre-commit hook and the CI step. The `--staged` scan does not
    inspect untracked files or history, and a clean merge commit runs
    `pre-merge-commit`, which validates only the tracker; neither scan
    inspects unreachable objects (spec, Out of scope, for untracked files
    and unreachable objects).
  - 4: `scripts/tests/gates.test.mjs` shows the gate red on staged probes,
    asserts redaction on the secret itself, and covers gitleaks absent, an
    odd gitleaks status, a missing config and a shallow clone; it runs in
    CI under `npm run test:scripts` (`if:
    steps.changes.outputs.docs_only != 'true'`). The exec-error and
    unresolvable-root refusals have no test (barwise-i23). The pre-commit hook reads every non-zero
    status as a finding and prints "credential-shaped content in the tree"
    and "ROTATE it" after a refusal too (barwise-jha). Pre-push reports a refusal
    separately only when no other gate failed.
  - 5: the version is assigned only in the install script today (it also
    appears in a `.gitleaks.toml` comment and a test stub), but nothing
    keeps `ci.yml` or the session hook from assigning another (same new
    issue as 2).
- Left open in the spec, not decided here (its Open decisions carry
  recommendations, none marked resolved; the first, keeping the local
  Anthropic rule, is settled by CLAUDE.md, which Decision 2 follows):
  - whether the wrapper should refuse a gitleaks other than the pin; today
    it prints the version (barwise-8fc);
  - whether `.gitleaksignore` entries are checked for staleness; no such
    file exists yet (barwise-flw);
  - whether GitHub push protection is enabled. The spec calls it "not
    assertable from this tree". `git push --no-verify`, the documented
    escape hatch for work in progress, lets a commit that also skipped
    pre-commit reach the remote before any scan (barwise-sma).
- Until architecture-index WS5 replaces them with links, the root
  `CLAUDE.md` conventions bullet, `credential-scanning.spec.md`, the
  headers of `check-secrets.mjs`, `.gitleaks.toml` and
  `install-gitleaks.sh`, the comments on the `ci.yml` secret-scan steps,
  the pre-commit hook, `.claude/hooks/session-start.sh`, and the
  check-secrets section of `scripts/tests/gates.test.mjs` also state this
  rule (barwise-ubc, WS5).
