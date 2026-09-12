# Credential scanning: a leaked secret is the one defect a follow-up commit cannot fix

Status: Implemented. The gate, its wiring and its tests landed with this
spec, and the history reading was taken (1056 commits, 0 findings).

Created: 2026-09-12
Last-updated: 2026-09-12
Tracking: barwise-1021 (the gate); barwise-1022 (the history reading);
barwise-1028 (send the Anthropic rule upstream). Triggered by the
"Principles of AI Development" manifesto, whose "Trust the boundaries, not
the agent" section names credential scanning as one of the deterministic
checks that let an agent run unsupervised. barwise-1023 and -1024 record the
manifesto's other gaps against this repository; -1025 was filed as a third
and proved not to be a gap (see Out of scope).

In one sentence: run gitleaks over committed content at the pre-commit hook
and in CI, behind a thin wrapper that supplies this repository's gate
contract, because every other gate in `ci.yml` guards something a later
commit can fix and this one does not.

## Principle

**Define errors out of existence**, applied to the one failure whose blast
radius does not shrink when you notice it late.

Read the gate list in `ci.yml` and every entry shares a property: a NUL
byte, a non-portable shell script, an unpinned Python call, a stale spec
header, a drifted copy. Each is caught late at the cost of a follow-up
commit. A committed credential is not in that class. Reverting the commit
does not un-leak it, deleting the branch does not un-leak it, and rewriting
history does not un-leak it -- the key must be rotated, by a person, in a
provider console. The defect is irreversible in a gate list where nothing
else is, and it was the only one with no gate.

**Explicit over implicit** names what stood in for the gate. `.gitignore`
covers `.env`, `.env.*` and `.beads-credential-key`. That is a shadow in
this repository's own vocabulary: it correlates with "no credential is
committed" through the mechanism _credentials live in dotenv files_, and it
diverges exactly where the mechanism is bypassed. Three bypasses are live
here rather than hypothetical:

- `barwise/eval-payloads/` and `barwise/eval-runs/` are **tracked**, and
  `.gitignore` carries a deliberate negation --
  `!barwise/eval-payloads/**/*.log` -- to keep run logs beside the payloads.
  These are written by tooling during an eval round and committed by
  convention, which is the one path here where a machine writes a tracked
  file containing whatever the process had in hand.
- Documentation shows commands. A pasted `curl` or a provider-setup snippet
  lands in a `.md` file that no dotenv rule covers.
- Test fixtures imitate real payloads, and the handiest thing to imitate a
  key with is a key.

None is a `.env` file, so the instrument standing in for this gate could not
see any of them. Two of the three are docs-only changes, which is why the CI
step carries no docs-only skip.

## Should we write our own detectors? (resolved: no -- and the first draft of this spec said yes)

**No, and this is the spec's largest correction.** The first version of this
gate shipped ten hand-written vendor-prefix regexes and an entropy argument
for preferring them. It was rejected in review on one sentence -- do not
build what others have built better -- and that is right, for a reason the
draft had inverted.

The draft rejected gitleaks on two grounds and both were weak:

- **"CLAUDE.md forbids trivial dependencies."** That rule reads "never add a
  package for something provided by JavaScript or Node core", and continues
  "high-quality libraries that solve real problems (yaml, ajv) are fine". A
  maintained corpus of ~150 provider rules with an entropy model is not
  something Node core provides. The rule was over-applied.
- **"`ci.yml` uses first-party `actions/*` only."** True, and satisfied
  without a third-party action: a pinned release tarball with a verified
  SHA-256, which is the same shape as the `pip install uv==0.12.7` already
  in that workflow.

What the draft could not see is the thing that settles it. A private rule
table has to track the providers of the world forever, and measurement
showed it losing in **both** directions:

| Probe                                                     | Ten regexes                   | gitleaks + one config rule             |
| --------------------------------------------------------- | ----------------------------- | -------------------------------------- |
| `AKIAIOSFODNN7EXAMPLE` (AWS's own documented example key) | flagged -- **false positive** | correctly allowlisted                  |
| Anthropic `sk-ant-api03-...`                              | flagged                       | **missed** -- so barwise adds the rule |
| Low-entropy synthetic (`ghp_0123456789abcdef...`)         | flagged                       | correctly ignored                      |

The first row is the one to notice. AWS's example key appears in AWS's own
documentation and in countless fixtures; a scanner that flags it fails every
commit that quotes a manual, and a gate that fails on documentation is a
gate that gets switched off. gitleaks knows that key by name. Nobody was
going to hand-maintain that list here.

### What survives as ours: one rule, measured

gitleaks 8.28.0 detects **no** Anthropic key. Three realistic shapes were
staged into a throwaway repo -- `ANTHROPIC_API_KEY=sk-ant-api03-<48>`, a
`key:` assignment, and an `x-api-key` header with an `sk-ant-admin01-` key
-- and it reported "no leaks found" for all three, including the plain
environment-variable assignment form its own `generic-api-key` rule catches
for OpenAI and Slack.

That matters more here than anywhere: `@barwise/llm` calls the Anthropic
API, the CLI reads `ANTHROPIC_API_KEY`, and an eval round writes tracked
files. **The credential this repository is most likely to leak is precisely
the one the scanner does not know.** So `.gitleaks.toml` is
`[extend] useDefault = true` plus exactly one rule, and barwise-1028 tracks
sending it upstream so we stop carrying it. Keeping it a single documented
exception is what stops the file becoming the private rule table this design
exists to avoid.

## Should the wrapper exist at all? (resolved: yes -- it supplies four things gitleaks does not)

A wrapper that renames three flags is a shallow module and should not exist.
This one is not that; it exists for four things, each of which is a rule in
this repository:

- **The third result.** gitleaks exits `1` for "found something" and other
  non-zero codes for "could not run". Collapsing those makes a tool failure
  read as a finding -- sending the reader hunting a credential that was never
  there -- or as a pass, which is the false green
  `docs/specs/gate-refusal-contract.spec.md` exists to forbid.
- **The shallow-clone refusal.** A history scan of a shallow clone reports a
  clean bill of health over whatever few commits arrived.
- **The missing-config refusal.** Without `.gitleaks.toml`, gitleaks falls
  back to its bundled defaults: it would still find most things and would
  silently drop the Anthropic rule. A gate running a weaker rule set than it
  claims is this spec's own subject.
- **An npm script.** `lib/ci-gates.mjs` derives the gate list from `ci.yml`'s
  `run: npm ...` steps, so `ci:local`, the pre-push hook and `fault-matrix`
  pick this gate up with no registration. A bare `run: gitleaks ...` would be
  invisible to all three.

It also prints the rotation instruction, which is the one thing a reader
needs and no scanner says.

## Scope

In scope, as requirements:

- When `npm run check:secrets` runs and gitleaks reports a finding, the
  system shall exit `1`, naming the rule, file and line.
- When the system reports a finding, it shall not print the credential.
- When gitleaks is absent, when `.gitleaks.toml` is absent, or when gitleaks
  exits with a status that is neither `0` nor `1`, the system shall exit `2`
  and shall not report a clean scan.
- When `npm run check:secrets` runs without `--staged` against a shallow
  clone, the system shall exit `2` naming the shallowness.
- When `npm run check:secrets -- --staged` runs, the system shall scan the
  index and shall not depend on clone depth.
- When a commit is created, the pre-commit hook shall run the `--staged`
  scan.
- When CI runs, the history scan shall run without `continue-on-error` and
  without a docs-only skip.
- When CI or the session bootstrap installs gitleaks, the system shall
  verify the release archive against a pinned SHA-256 and refuse on
  mismatch.

Out of scope:

- **Rewriting history.** If a scan ever finds a real credential, the remedy
  is rotation. History surgery does not undo an exposure and must not be
  mistaken for doing so.
- **Unreachable objects.** This is a capability the rewrite gave up and it
  is worth naming. The hand-rolled version walked
  `git cat-file --batch-all-objects`, so it saw a blob left behind by an
  amend or a `reset --hard`; `gitleaks git` walks reachable commits, as
  trufflehog and GitHub's own scanning also do. The practical exposure is
  the remote's reachable history, and local unreachable objects are pruned
  by `git gc`, so the narrower scope is the standard one -- but it is
  narrower, not equivalent.
- **Untracked files.** `--staged` scans the index and the history scan scans
  commits, so a file written and never added is outside both.
- **Static analysis of first-party source** (barwise-1025). Credential
  scanning asks what is _in_ the tree; SAST asks what the code _does_.

  **This spec's first draft said there was none, and that was wrong.** CodeQL
  runs on every PR over javascript-typescript and python under GitHub's
  **default setup** -- no workflow file, `path:
  dynamic/github-code-quality/codeql`, both jobs green on this PR. The
  instrument that produced the false claim was a grep over
  `.github/workflows`, which is a shadow of "is SAST configured" correlating
  through the mechanism _CI configuration lives in workflow files_, and it
  diverges exactly where default setup is used, because that configuration is
  not in the tree at all. This spec makes the same argument about push
  protection below; the blind spot was failing to run it in the other
  direction, where a setting can be ON without the tree saying so. What
  survives in -1025 is narrower: nothing here asserts that code scanning is
  still enabled, and a repository setting can be switched off without any
  file changing.

## Inventory

| File                             | Before                                    | Verdict                                                 |
| -------------------------------- | ----------------------------------------- | ------------------------------------------------------- |
| `scripts/check-secrets.mjs`      | did not exist; then ten regexes           | new: a refusing wrapper, no detection of its own        |
| `.gitleaks.toml` (repo root)     | did not exist                             | new: `useDefault` plus the one measured gap             |
| `scripts/install-gitleaks.sh`    | did not exist                             | new: the single home for the pinned version+digest      |
| `scripts/lib/tracked.mjs`        | exports guarded `REPO_ROOT`               | `REPO_ROOT` imported; `trackedFiles()` no longer needed |
| `scripts/tests/gates.test.mjs`   | 1907 lines                                | gains 9 cases                                           |
| `package.json`                   | no `check:secrets`                        | new script                                              |
| `package.json` (repo root)       | generated forwarder list                  | regenerated by `scripts/regen-root-package.mjs`         |
| `.github/workflows/ci.yml`       | 28 gates, none for credentials            | an install step and the gate, both unconditional        |
| `.husky/pre-commit`              | beads, lint-staged, build, affected tests | gains the `--staged` scan                               |
| `.claude/hooks/session-start.sh` | installs npm deps and uv                  | also installs gitleaks and unshallows the clone         |
| `.gitignore`                     | covers `.env`, `.env.*`                   | untouched -- kept, no longer load-bearing alone         |
| `scripts/lib/ci-gates.mjs`       | parses `run: npm ...` out of `ci.yml`     | untouched; picks the gate up by derivation              |

`scripts/audit-gate.mjs` looks affected and is not: it reads `npm audit`,
which is about dependencies rather than content, and the two share no logic.
`packages/llm/src/observe/` writes the JSONL call log that would be the
obvious leak candidate, and writes it under the operator's state directory,
outside the repository.

## Target architecture

```
.gitleaks.toml           [extend] useDefault = true
                         + anthropic-api-key   (the one measured gap)

scripts/install-gitleaks.sh
                         VERSION + per-platform SHA-256, verified before
                         unpacking. Called by ci.yml AND by the session
                         hook -- one home, so the two cannot drift into
                         applying different rule sets to the same diff.

scripts/check-secrets.mjs
  imports REPO_ROOT from ./lib/tracked.mjs   -> exit 2 on an unresolvable root

  gitleaks absent            -> exit 2
  .gitleaks.toml absent      -> exit 2   (defaults would drop the one rule)
  shallow clone, no --staged -> exit 2
  gitleaks exit 0            -> exit 0, printing the version it used
  gitleaks exit 1            -> exit 1, findings + ROTATE FIRST
  gitleaks anything else     -> exit 2

  default    gitleaks git             (all reachable commits; CI, fetch-depth 0)
  --staged   gitleaks git --staged    (the index; pre-commit, depth-independent)

  always     --redact    the credential never reaches a CI log
             --verbose   without it the output is "leaks found: 1" and no
                         rule, file or line -- and the fingerprint it prints
                         is what .gitleaksignore needs
```

## Alternatives considered

- **Ten hand-written vendor regexes.** What the first draft built, and
  removed. Resolved above: it flagged AWS's documented example key and would
  have needed permanent maintenance to stay level with a tool that is
  already maintained.

- **trufflehog instead of gitleaks.** Its live-verification step (calling the
  provider to see whether a key actually works) is a genuinely better
  precision story. It is also a network call from a gate, which this
  repository's determinism rule pushes out of the inner loop, and a pre-commit
  hook that reaches the internet fails differently offline. gitleaks is
  static and offline. Revisit for a periodic audit rather than a per-commit
  gate.

- **A third-party GitHub Action.** Rejected, kept out: the workflow is
  first-party `actions/*` only, and a secret scanner is a poor place to widen
  that, since it reads every file with whatever permissions the job has. A
  pinned tarball with a verified digest gets the tool without the trust.

- **GitHub push protection and secret scanning.** Should be on regardless,
  and not a substitute: it is a repository setting no file in this tree can
  assert, it does not run in the pre-commit hook, and it cannot be shown red
  by `gates.test.mjs`. A second layer, not this layer.

- **`gitleaks dir` over the working tree** instead of scanning git. Measured
  and rejected: it read 91.62 MB and produced 8 findings, every one inside
  `node_modules`, `.venv` or `dist/` -- all gitignored, none tracked. The
  question is what is _committed_, and `git`/`--staged` ask exactly that
  without an allowlist for vendored paths.

- **A pre-push gate rather than pre-commit.** `--staged` costs ~0.15s.
  Pre-push would let a credential reach a local commit, and the commit is the
  object that gets pushed, shared, stashed and copied into a worktree.

## Evidence

Readings, not claims:

| Check                                  | Reading                                                                                  |
| -------------------------------------- | ---------------------------------------------------------------------------------------- |
| History scan (all reachable commits)   | 1056 commits, 24.87 MB, **0 findings**, ~1.8 s                                           |
| `--staged` scan                        | **0 findings**, ~0.15 s                                                                  |
| Anthropic rule, three realistic shapes | **3 of 3** detected; placeholder and `${VAR}` indirection not flagged                    |
| gitleaks without our rule              | **0 of 3** -- which is why the rule exists                                               |
| `gitleaks dir` (rejected scope)        | 8 findings, all in `node_modules`/`.venv`/`dist/`                                        |
| `test:scripts`                         | 99 -> 107 cases, no new failures                                                         |
| `ci:local`                             | **all 32 gates green**                                                                   |
| `fault-matrix`                         | `git-empty=REFUSED git-absent=REFUSED git-shallow=INDEPENDENT cwd=INVARIANT`, 0 findings |

**Verified red**, four mutations through `npm run mutate`:

| Mutation                                                   | Tests failing |
| ---------------------------------------------------------- | ------------- |
| the Anthropic rule's prefix changed so it cannot match     | 1             |
| `--redact` removed                                         | 3             |
| `--verbose` removed (no rule, file or line for the reader) | 3             |
| the three-way exit split collapsed                         | 1             |
| the shallow-clone refusal never fires                      | 1             |

**The `--redact` mutation was UNCAUGHT on the first attempt, and fixing that
is the most useful thing in this section.** The assertion checked that the
whole probe line was absent from the output. Without redaction gitleaks
prints `Finding: aws_key = "<ESC>[1;3;mAKIA...` -- the key in the clear, but
with an ANSI sequence between the quote and the key and no closing quote --
so the line never appeared verbatim, the check passed, and the one property
this gate exists to hold was unasserted while reading as covered. The probes
now carry the secret and its surrounding line as separate fields, and the
assertion is on the secret.

## Open decisions (for review)

- **Is the local Anthropic rule the right call, or should we wait for
  upstream?** Recommended: keep it and push upstream (barwise-1028). Waiting
  means the repository's most likely credential is unguarded in the interim,
  and the rule is four lines.

- **Should the pinned gitleaks version be asserted rather than just
  printed?** Today the gate prints the version it used, and CI installs the
  pin, so CI's reading is reproducible while a developer with a
  package-manager gitleaks gets a useful but not identical check. Refusing on
  a mismatch would make every reading reproducible and would also block a
  commit for someone whose distro ships 8.16. Recommended: keep printing.
  Revisit if two readings ever disagree.

- **Should `.gitleaksignore` entries be staleness-checked?** The hand-rolled
  version failed on an allowlist entry that matched nothing, the way
  `audit-baseline.json` and `rubric-baseline.json` do. gitleaks has no such
  check, so delegating gave that up. The file does not exist yet, so nothing
  is rotting. Recommended: leave it, and add the check with the first entry.

- **Should GitHub push protection be enabled?** Not assertable from this
  tree, so it cannot be a workstream. Recommended: yes, as a second layer, by
  whoever holds repository settings.

## Risks and testing

- **A false positive blocks every commit in the repository.** This is the
  risk that turns a gate off, and it is the main thing delegation buys: the
  AWS-example-key row above is a false positive the hand-rolled version had
  and gitleaks does not.
- **The probes must be assembled at runtime, and the FIELD NAME matters as
  much as the value.** The gate scans this repository's whole history
  including its own tests, so a literal credential-shaped string in
  `gates.test.mjs` would make the gate fail on its own test forever after.
  Both PEM armour lines are split, not just the opening one, because the rule
  matches from `BEGIN` across to the closing marker. And the probe table's
  field was first called `secret`, which made
  `secret: "<high-entropy string>"` match gitleaks' own `generic-api-key`
  rule: the gate failed on its own test file. The field is `probe` and the
  bodies are split into short runs. The gate caught this itself, and only
  once the file was staged -- an unstaged file is outside both the index scan
  and the commit walk, which is the `check-no-nul` blind spot in a new
  costume.
- **Probe entropy is part of the test.** A first attempt used sequential
  alphabets, fell below gitleaks' entropy threshold, and went undetected --
  which would have proved the wrapper silent rather than the scanner working.
- **The pinned digest must be verified before unpacking.** Unpacking runs no
  code, but nothing downstream should ever see unverified bytes.
- **Behaviour that must not change:** every existing gate's reading. This
  spec adds a gate and touches no other one.

## Non-goals

- No new capability on any surface; the capability matrix is untouched.
- No npm dependency; gitleaks is a pinned binary, not a package.
- No change to what any existing gate checks.
- No history rewriting, now or later.
- No private rule table. `.gitleaks.toml` holds one rule, bound to an
  upstream issue.
