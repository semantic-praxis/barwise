# Credential scanning: a leaked secret is the one defect a follow-up commit cannot fix

Status: Implemented. WS1 (the gate and its wiring) and WS2 (the history
reading, 6314 blobs, 0 findings) both landed with this spec.

Created: 2026-09-12
Last-updated: 2026-09-12
Tracking: barwise-1021 (the gate); barwise-1022 (the history reading).
Triggered by the "Principles of AI Development" manifesto, whose
"Trust the boundaries, not the agent" section names credential scanning as
one of the deterministic checks that let an agent run unsupervised.
barwise-1023, -1024 and -1025 record the manifesto's other three gaps
against this repository; they are not this spec's subject.

In one sentence: gate tracked files against ten anchored credential
detectors, because every other gate in this repository guards something a
later commit can fix, and this one does not.

## Principle

**Define errors out of existence**, applied to the one failure whose blast
radius does not shrink when you notice it late.

Read the gate list in `ci.yml` and every entry shares a property: a NUL
byte, a non-portable shell script, an unpinned Python call, a stale spec
header, a drifted copy. Each is caught late at the cost of a follow-up
commit. A committed credential is not in that class. Reverting the commit
does not un-leak it, deleting the branch does not un-leak it, and
rewriting history does not un-leak it -- the key must be rotated, by a
person, in a provider console. The defect is irreversible in a gate list
where nothing else is, and it is the only one with no gate.

**Explicit over implicit** names what stands in for the gate today.
`.gitignore` covers `.env`, `.env.*` and `.beads-credential-key`. That is
a shadow in this repository's own vocabulary: it correlates with "no
credential is committed" through the mechanism _credentials live in dotenv
files_, and it diverges exactly where the mechanism is bypassed. Three
bypasses are live here rather than hypothetical:

- `barwise/eval-payloads/` and `barwise/eval-runs/` are **tracked**, and
  `.gitignore` carries a deliberate negation --
  `!barwise/eval-payloads/**/*.log` -- to keep run logs beside the
  payloads. Those files are written by tooling during an eval round and
  committed by convention, which is the one path in this repository where
  a machine writes a tracked file containing whatever the process had in
  hand.
- Documentation shows commands. A pasted `curl` or a provider-setup
  snippet lands in a `.md` file that no dotenv rule covers.
- Test fixtures imitate real payloads, and the most convenient thing to
  imitate a key with is a key.

None of those is a `.env` file, so the instrument that stands in for this
gate cannot see any of them. Kitchenham, Pfleeger and Fenton's requirement
is the same point stated formally: `.gitignore` is an instrument whose
relation to the outcome holds only under a condition nobody wrote down.

## Should the detectors be anchored or entropy-based? (resolved: anchored, and it is measured)

Anchored on vendor prefixes, because this repository is full of exactly the
shape an entropy detector fires on, and a gate with false positives gets
switched off.

`package-lock.json` carries an `integrity: sha512-...` field per entry. The
prompt lane records a `promptHash` per run. `packages/diagram-ui/tests/golden/`
holds serialised SVG. Every one is a long, high-entropy, base64-or-hex
string, and an entropy threshold cannot distinguish them from a secret
because on the measured attribute they are identical. The divergence is not
a tuning problem to be solved with a better threshold; entropy is a shadow
of "this is a credential" through the mechanism _credentials are random_,
and it is bypassed by every other random string in the tree.

Anchoring on the issuing vendor's own prefix inverts that. The prefixes for
Anthropic, GitHub, AWS, Google, Slack and npm are namespaces a provider
controls and nothing else emits by accident.

Measured, both directions, on the tree at `46e462d`:

| Reading                                                      | Result        |
| ------------------------------------------------------------ | ------------- |
| Tracked files                                                | 1612          |
| Scanned (10 skipped as known-binary extensions)              | 1602, 15.5 MB |
| Wall time                                                    | 0.16 s        |
| Findings                                                     | **0**         |
| Detectors that fire on a synthetic sample of their own shape | **10 of 10**  |
| Decoys tested                                                | 6             |
| False positives on those decoys                              | **0**         |

The decoys are the shapes that would break an entropy rule: a `sha512-`
lockfile integrity value, a 32-character hex digest of the `promptHash`
shape, a redacted placeholder, an environment indirection, a bearer header
whose value is a shell variable, and a vendor prefix too short to be a key.

**Both halves of that reading are load-bearing, and the second is the one
this repository has learned to demand.** A detector set measured only
against a clean tree is byte-identical to a detector set that cannot fire
at all -- barwise-902's shape, a check that banks a guaranteed point
instead of measuring. So the ten samples are asserted as tests, not run
once by hand.

## Scope

In scope, as requirements:

- When `npm run check:secrets` runs and a tracked file matches a credential
  detector, the system shall exit `1`, naming the file, the line and the
  detector.
- When the system reports a match, it shall not print the matched text.
- When `npm run check:secrets` runs and no tracked file matches, the system
  shall exit `0` and report how many files it scanned.
- When the tracked-file listing or the repository root cannot be resolved,
  the system shall exit `2` rather than reporting a clean scan.
- When an allowlist entry matches nothing in the tree, the system shall
  exit `1` naming that entry as stale.
- When `check-secrets --history` runs against a shallow clone, the system
  shall exit `2` naming the shallowness, rather than reporting a clean
  history.
- When a commit is created, the pre-commit hook shall run this gate.
- When CI runs, the gate shall run without `continue-on-error`, and without
  a docs-only skip.

Out of scope:

- **Rewriting history.** If a history scan ever finds a real credential, the
  remedy is rotation. History surgery is a separate decision that does not
  undo an exposure and must not be mistaken for doing so. (WS2 has since
  run and found none, so this stays a rule rather than a plan.)
- **Untracked files.** The gate enumerates through `git ls-files`, so a
  probe written to disk and never staged is invisible to it. That blind
  spot is asserted as a test rather than left for someone to rediscover
  (the barwise-906 precedent, where a NUL probe was "verified" against a
  file the gate could not reach).
- **Secrets in a developer's environment or shell history.** Not in the
  tree, not this gate's question.
- **Static analysis of first-party source** (barwise-1025). Credential
  scanning asks what is _in_ the tree; SAST asks what the code _does_.

## Inventory

| File                           | Current state                                        | Verdict                                              |
| ------------------------------ | ---------------------------------------------------- | ---------------------------------------------------- |
| `scripts/check-secrets.mjs`    | does not exist                                       | new: the gate (WS1)                                  |
| `scripts/lib/tracked.mjs`      | exports guarded `REPO_ROOT`, `trackedFiles()`        | imported unchanged -- the refusal comes free         |
| `scripts/tests/gates.test.mjs` | 1907 lines; `tempRepo`/`stage` helpers already there | gains WS1's tests                                    |
| `package.json`                 | no `check:secrets` script                            | new script (WS1)                                     |
| `package.json` (repo root)     | generated forwarder list                             | regenerated by `scripts/regen-root-package.mjs`      |
| `.github/workflows/ci.yml`     | 28 gates, none scanning for credentials              | one step, unconditional (WS1)                        |
| `.husky/pre-commit`            | beads check, lint-staged, build, affected tests      | gains the gate (WS1)                                 |
| `.gitignore`                   | covers `.env`, `.env.*`, `.beads-credential-key`     | untouched -- kept, just no longer load-bearing alone |
| `scripts/lib/ci-gates.mjs`     | parses `run: npm ...` steps out of `ci.yml`          | untouched; picks the gate up by derivation           |

Two rows that look affected and are not. `scripts/audit-gate.mjs` is the
other security gate and is untouched: it reads `npm audit`, which is about
dependencies rather than tree contents, and the two share no logic worth
extracting. `packages/llm/src/observe/` writes the JSONL call log that
would be the obvious leak candidate, and it writes under the operator's own
state directory, which is not in the repository at all.

**`scripts/lib/ci-gates.mjs` earns its row by being untouched.** It derives
the gate list from `ci.yml`, so `npm run ci:local`, the pre-push hook and
`npm run fault-matrix` all pick this gate up with no registration. The
requirement "when a new gate is added to ci.yml, the system shall include
it in the fault matrix without further declaration" is already discharged
by that module; this spec only has to not break it, which means the CI step
must be spelled `run: npm run check:secrets` and not an inline
`node scripts/...`.

## Target architecture

```
scripts/check-secrets.mjs
  imports  REPO_ROOT, trackedFiles()   from ./lib/tracked.mjs
                                       -> exit 2 on an unresolvable root
                                          or an empty listing, for free

  DETECTORS  [{ name, re }]            ten anchored patterns
  ALLOWLIST  [{ file, detector, reason }]
                                       declared exceptions; a stale one fails

  default mode    tracked working tree    -> exit 0 | 1 | 2
  --history       every blob in the object -> exit 2 on a shallow clone
                  database, unreachable
                  ones included

  reporting       file:line + detector + match LENGTH
                  never the matched text
```

The masking rule is a design decision, not a nicety. A gate that prints
what it found writes the credential into a CI log, and CI logs are
retained, searchable and frequently public -- so a gate built to reduce
exposure would become a second, durable copy of it. The report carries
enough to find the line and nothing that helps use the key.

## Alternatives considered

- **Add `gitleaks` or `trufflehog`.** Both are better detectors than ten
  regexes, and both lose on this repository's terms. CLAUDE.md forbids a
  dependency for something Node core provides, and `ci.yml` uses
  first-party `actions/*` only -- the supply-chain spec called widening
  that "not this change's call", and a secret scanner is a poor place to
  start, since it runs over every file in the tree with whatever
  permissions the job has. A binary install also fails differently in a
  container without it, which is the `check-shell` refusal shape again.
  Revisit if the detector list starts needing real maintenance.

- **GitHub's own push protection and secret scanning.** Should be on
  regardless, and it is not a substitute: it is a repository setting no
  file in this tree can assert, it does not run in the pre-commit hook, and
  it cannot be shown red by `gates.test.mjs`. It is a second layer, not
  this layer.

- **Entropy thresholds.** Resolved above: the tree is full of high-entropy
  strings that are not credentials, and no threshold separates them.

- **Scan only the paths where a machine writes tracked files**
  (`eval-payloads/`, `eval-runs/`). Cheaper and wrong for the same reason
  `check-no-nul` scans everything: the value of a whole-tree gate is that
  it does not depend on someone predicting where the next instance
  appears. The measured cost of scanning everything is 0.16 s.

- **A pre-push gate rather than pre-commit.** The hooks split by cost, and
  this one costs 0.16 s -- the same order as the beads check that already
  runs pre-commit. Pre-push would let a credential reach a local commit,
  and the commit is the object that gets pushed, shared, and copied into a
  stash or a worktree.

## Workstreams

### 1. The gate, its wiring, and its tests (landed with this spec)

`scripts/check-secrets.mjs`, `npm run check:secrets`, the regenerated root
forwarder, the `ci.yml` step, the pre-commit line, and the tests in
`gates.test.mjs`.

Acceptance, as a reading rather than a claim: the gate is GREEN on this
tree from three cwds, RED on a staged probe of each of the ten shapes in a
throwaway repo, RED on a stale allowlist entry, exit `2` under a `git` that
answers emptily and under one that fails, and exit `2` on `--history` in a
shallow clone. Every one of those is a test in `gates.test.mjs`, and the
red readings are established before the green one is trusted.

Landed as specified. 18 tests, `test:scripts` 99 cases to 117 with no new
failures, and all 32 gates in `ci:local` green.

**Verified red**, three mutations through `npm run mutate` so the reading is
the command's own status rather than a belief about it:

| Mutation                                                                        | Tests failing |
| ------------------------------------------------------------------------------- | ------------- |
| a detector's length floor raised so it can never fire                           | 1             |
| `length: m[0].length` becomes `length: m[0]`, leaking the match into the report | **11**        |
| the shallow-clone comparison never matches, so `--history` answers anyway       | 1             |

The middle row is the one worth reading. The masking rule looks like a
convention a future "print it to help debugging" change could quietly
reverse, and eleven assertions fail on it -- the ten per-detector cases plus
`--history`. It is cheap to enforce because `scan` never puts the matched
text in the finding at all, so there is nothing downstream to leak; that is
"define errors out of existence" applied to the gate's own output.

**The fault matrix conforms, measured rather than declared**:
`git-empty=REFUSED  git-absent=REFUSED  git-shallow=INDEPENDENT
cwd=INVARIANT`, 4 readings, 0 findings. The gate was picked up with no
registration, which is the Inventory's claim about `lib/ci-gates.mjs`
discharged by observation. `git-shallow=INDEPENDENT` is the right reading
and not a gap: a shallow clone holds the whole working tree, so the default
mode has nothing to refuse, while `--history` refuses -- two modes, two
different questions, and the matrix runs `ci.yml`'s arguments.

### 2. The history reading (barwise-1022 -- taken, after the refusal forced it)

**6314 blobs in the object database, 10 detectors, 0 findings, 2.1
seconds.** Across all 1593 commits and the unreachable objects beside them,
no credential has ever been committed to this repository.

The route to that number is the part worth recording, because the refusal
is what produced it. The session began in a shallow clone --
`git rev-parse --is-shallow-repository` returned true and the earliest
reachable commit was 2026-09-07, against a project whose specs start in
June. `--history` refused with exit `2`. Had it answered, it would have
reported clean over the 5096 objects that clone happened to hold and the
reading would have been filed as an audit of the project's history, which
it would not have been. Refusing cost one `git fetch --unshallow` and
turned an unanswerable question into an answered one.

So the workstream landed here rather than becoming an operator action. What
remains open is only the recurrence: every fresh session clone is shallow
again, so this reading is a point-in-time audit rather than a standing
guarantee. The standing guarantee is WS1, which runs on every commit and
every CI job and needs no history at all.

**The draft said "every blob in every ref", and building it showed that is
the wrong set.** A credential removed by an amend or a `reset --hard` is
_unreachable_, not gone: the blob stays in the object database and ships to
anyone who clones. So a ref walk would report clean on a repository that
still hands the key out, which is the exact false green this mode exists to
avoid. The implementation reads `git cat-file --batch-all-objects`, and the
case is pinned by a test that commits a probe, resets past it, confirms the
working-tree scan is GREEN, and requires `--history` to be RED on the same
tree.

The general lesson, since this spec is partly about instruments: the
gate-refusal contract paid for itself inside the change that added a gate to
it. A mode that answered anyway would have produced a plausible clean bill
of health over four days of history, nobody would have re-run it, and the
project would carry a recorded audit of something that was never audited.

## Open decisions (for review)

This session had no requester to interview, so the assumptions that would
have been questions are here rather than resolved silently.

- **Is credential scanning the right first pick?** The manifesto exposes
  four gaps against this repository, filed as barwise-1021 (this spec),
  -1023 (no browser can render the UI an agent changes), -1024 (property
  tests only in `core`) and -1025 (no SAST). This one was chosen for being
  the only irreversible one, and for closing completely in one workstream
  with no new dependency. **-1023 is probably the larger win** -- it is the
  one that currently puts a human in the loop as the only renderer -- and
  it needs a direction call (a browser over the React canvas, or a
  rasteriser over the server-side SVG) before it can have a spec.
  Recommended: land this, decide -1023 next.

- **Should a medium-precision assignment tier be added?** A rule matching
  an `api_key`/`secret`/`token`/`password` assignment with a long quoted
  literal catches a credential from a vendor whose prefix nobody
  enumerated. It also fires on fixtures, documentation and any config
  example, so it brings the false-positive class that anchoring was chosen
  to avoid. Recommended: not yet. Revisit if a real leak is ever missed,
  and add it as a separate warn-only tier rather than widening the blocking
  one.

- **Should allowlist entries expire, like `audit-gate`'s ACCEPTED list?** An
  expiry forces periodic review; it also fails a build for a test fixture
  that was fine all along and will be fine next quarter. The stale-entry
  check already stops the list rotting in the direction that matters (an
  entry outliving its file). Recommended: no expiry.

- **Should GitHub push protection be enabled on the repository?** Not a
  code change and not assertable from this tree, so it cannot be a
  workstream. Recommended: yes, as a second layer, by whoever holds
  repository settings.

## Risks and testing

- **The gate must be verified red before its green is worth anything.** Ten
  staged probes, one per detector, in a throwaway repo -- never by staging
  into this one. `npm run mutate` over the detector table establishes that
  the tests fail when a detector is removed.
- **The gate scans its own source, its own tests and this spec.** All three
  necessarily discuss the patterns they match. The patterns are written as
  regexes with character classes, and the test probes are built by
  concatenation at runtime, so no file in this change contains a literal
  that matches. That is the `NUL` escape idiom already at the top of
  `gates.test.mjs`, and the failure it prevents is this gate failing on
  itself.
- **A false positive blocks every commit in the repository.** This is the
  risk that turns a gate off. It is why the detector set is anchored, why
  the reading above measures decoys as well as samples, and why an
  allowlist exists at all.
- **The masking rule is itself a risk if it is got wrong.** A future change
  that prints the match to "help debugging" would put the credential in the
  CI log. The test asserts the match text is absent from both streams, so
  that change fails.
- **Behaviour that must not change:** every existing gate's reading. This
  spec adds a gate and touches no other one.

## Non-goals

- No new capability on any surface; the capability matrix is untouched.
- No new npm or system dependency.
- No change to what any existing gate checks.
- No history rewriting, now or as a follow-up to WS2.
