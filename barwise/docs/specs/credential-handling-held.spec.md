# Credential handling, held by tests that need no gitleaks

Status: Draft -- no workstream implemented
Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor batch 6, credential half),
barwise-ym8.7zs, barwise-ym8.kf3, barwise-ym8.gc7, barwise-ym8.nxs
Touches: +barwise/scripts/tests/credential-handling.test.mjs,
barwise/scripts/tests/expected-counts.json,
barwise/docs/adr/credential-handling.md, barwise/docs/ARCHITECTURE.md

## Principle

`docs/adr/credential-handling.md` has four decisions, and each gap issue
names a violation that passes today. All four are literal text in files
the repository tracks: a second `[[rules]]` table, a CI step with an
`if:`, a hook that stops passing `--staged`, a workflow that downloads
gitleaks itself. So the enforcer is a test that reads those files, and
it runs whether or not gitleaks is installed. Of the existing tagged
tests in `gates.test.mjs`, the `gitleaks-detects` probes, the
missing-config test and the shallow-clone test need gitleaks and skip
without it; two `wrapper-contract` tests use a stand-in and do not.
`scan-index-and-history` and `pinned-gitleaks` have no tagged test at
all. The tests here never skip.

## The reading this spec starts from (main at 79ed6513)

- `.gitleaks.toml`: `[extend] useDefault = true` and one `[[rules]]`,
  `anthropic-api-key`. Nothing fails on a second rule (barwise-ym8.7zs).
- `ci.yml` runs `npm run check:secrets` with no `if:`, after a checkout
  with `fetch-depth: 0`; `barwise/.husky/pre-commit` calls
  `scripts/hooks/check-staged-secrets.sh`, which runs `npm run --silent
  check:secrets -- --staged`. Nothing fails when either changes
  (barwise-ym8.kf3).
- `check-secrets.mjs` refuses when `run.error` is set (gitleaks present
  but failing to spawn), and builds its argv with `--redact` and
  `--verbose`. Redaction is asserted by the staged-probe tests, and
  `--verbose` only indirectly (the rule id appears in the output where
  gitleaks runs); the spawn-error refusal has no test (barwise-ym8.gc7).
- `install-gitleaks.sh` holds the version and digests and verifies with
  `sha256sum -c` before `tar`. `ci.yml` and the session hook call it.
  Nothing fails when either installs gitleaks another way, or when the
  verification moves after the unpack (barwise-ym8.nxs).

## Scope

One test file, `scripts/tests/credential-handling.test.mjs`, each test
tagged with the decision it holds:

1. **`gitleaks-detects`**: `.gitleaks.toml` parses to exactly
   `[extend] useDefault = true` and one `[[rules]]` whose `id` is
   `anthropic-api-key`. Read as text with a small TOML-table reader
   (table headers and `key = value` lines), since the file uses no other
   TOML forms; an unrecognised line fails the test rather than being
   skipped.
2. **`scan-index-and-history`**: the `ci.yml` step that runs `npm run
   check:secrets` carries no `if:`, no `continue-on-error` and no
   `--staged`, and its job's checkout sets `fetch-depth: 0`;
   `barwise/.husky/pre-commit` has, as an uncommented line, exactly
   `sh scripts/hooks/check-staged-secrets.sh || exit $?` (so `|| true`
   or a commented-out call fails), and that script runs
   `check:secrets -- --staged` and passes its status through.
3. **`wrapper-contract`**, in a throwaway repository with
   `.gitleaks.toml` committed (the wrapper refuses before scanning
   without it), running the wrapper with `node` by absolute path and a
   `PATH` of only the stand-in directory, `/usr/bin` and `/bin`. The
   restricted `PATH` is required: Node's spawn skips a file it cannot
   execute and keeps searching, so with the usual `PATH` the real
   gitleaks in `/usr/local/bin` or CI's `~/.local/bin` would answer
   instead (plan review, measured). Each test asserts its stand-in was
   the one that ran.
   - the stand-in answers `version`, then removes every execute bit
     (`chmod a-x`, since root can execute a file any x bit remains on),
     so the scan's spawn fails: the wrapper exits 2 and says gitleaks
     could not be executed;
   - the stand-in records its argv and exits 0: the scan was called with
     `--redact`, `--verbose`, `--no-banner` and `--config` naming the
     repository's `.gitleaks.toml`, and `--staged` exactly when asked.
4. **`pinned-gitleaks`**:
   - `ci.yml` and `.claude/hooks/session-start.sh` each call
     `install-gitleaks.sh`, and in each, with comments stripped and
     quoted strings blanked, every remaining mention of `gitleaks` is
     the installer's own name or a YAML `name:`. An allowlist rather
     than a list of banned forms: `uses: gitleaks/gitleaks-action`,
     `go install`, a docker image and a package manager all fail
     without being named (plan review);
   - the installer, run with stand-in `curl` (writing bytes that cannot
     match a digest) and `tar` (recording that it ran) first on a `PATH`
     with no gitleaks, exits 2 with "CHECKSUM MISMATCH" and `tar` never
     ran, so the digest is checked before anything is unpacked.

The ADR's `Enforced-by` becomes `tests (gitleaks-detects,
scan-index-and-history, wrapper-contract, pinned-gitleaks)`, and the
four gap entries go, with their issues closed in a tracker-only PR.

Out of scope: whether the gate refuses an unpinned gitleaks on PATH
(barwise-8fc); sending the Anthropic rule upstream (barwise-1028); a
clone with no hooks wired (barwise-mdp, barwise-1016).

## Alternatives considered

- **A gate (`check:credential-pins`) instead of tests.** Probes would
  then apply, and the ADR would name an `npm` entry. But each property
  is a fact about one or two files, `check:adr-tests` already holds a
  `tests` decision to a passing tagged test in CI, and a gate adds a
  script, a CI step and a root forwarder for no extra reach. Rejected.
- **Parsing TOML and YAML with libraries.** `yaml` is already a
  dependency and the test uses it for `ci.yml`; a TOML parser would be a
  new dependency for a 40-line file that uses two TOML forms. The
  hand reader fails on anything it does not recognise, so it cannot
  pass a form it cannot read.
- **Testing the installer against the real download.** Needs the
  network and a real mismatch; stand-ins make the ordering claim
  (verify, then unpack) testable offline.

## Workstreams

### 1. The tests and the ADR

The test file per Scope, each test seen red first by planting its
violation (a second rule, an `if:` on the step, `--staged` dropped, the
`--verbose` flag dropped, `sha256sum` moved after `tar`) with
`mutate.mjs`; `expected-counts.json`; the ADR's header and
Consequences; `ARCHITECTURE.md` regenerated.

## Risks and testing

- A stand-in `gitleaks` on `PATH` must win over the installed one; the
  test puts its directory first and asserts the recorded argv exists, so
  a real gitleaks answering instead fails the test rather than passing
  it.
- The installer test must not reach the network or the real
  `/usr/local/bin`: `PATH` is the stand-in directory plus `/usr/bin` and
  `/bin`, and `BIN_DIR` is a temporary directory.

## Non-goals

- Changing what gitleaks detects, or the wrapper's behaviour.
