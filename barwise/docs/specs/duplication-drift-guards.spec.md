# Make must-agree code pairs fail loudly when they drift, without removing the duplication the principles keep

Status: Implemented (all six workstreams; see Implementation notes)
Created: 2026-08-26
Last-updated: 2026-08-26
Tracking: `docs/logic-duplication-audit-2026-08-26.md` (all classes);
extends the remedy of `docs/specs/artifact-resolution-parity.spec.md`
(implemented, PR #347) from one instance to the class. Issues:
barwise-862 (W1), barwise-868 (W2), barwise-869 (W3), barwise-870
(W4), barwise-871 (W5), barwise-872 (W6); the audit's diverged-copy
findings are barwise-863..867 and 873. Hand-authored into
`.beads/issues.jsonl` (canonical form, `check:beads --strict` clean);
`bd` itself is unavailable in this container.

## Principle

DRY is secondary in this codebase, and this spec keeps it secondary:
where an abstraction would couple two packages, the duplication stays.
What the audit showed is that the codebase already relies on a
stronger, unstated rule to make that trade safe -- and honors it only
sometimes:

> A decision stated twice is owned once: every must-agree pair
> carries a mechanical check -- a shared owner, a derivation from one
> authority, or a drift test. A "must match" comment is not a check.

Where the rule was honored, it worked every time: the
`builtins.generated.ts` drift test, the tutorial byte-compare, the
train-reference regeneration that shares its renderer with its guard.
Where the rule was left to prose, the copies drifted every time
grease was applied elsewhere: the extraction default fell behind its
variants, `TIMESTAMP` maps to two conceptual types, the dbt walker
mines compiled SQL, and two "Must match" comments guard the naming
agreement between core's mapper and the format exporters. The failure
form is Ousterhout's unknown unknowns: nothing tells the editor of
copy A that copy B exists.

The remediation hierarchy, in order of preference, with orthogonality
deciding when the first two are off the table:

1. **Share** -- one owner function or constant, when the copies can
   already import a common home without a new coupling
   (`matchesConstraintType` into one core module; `quoteIdent`;
   the merge-acceptance builder into `core/diff`).
2. **Derive** -- build the restatement from the authority at run or
   build time (CLI help and zod enums from `listImporters()`;
   membership arrays from `Record<Union, true>` tables).
3. **Check** -- a drift test over copies that deliberately stay
   separate (the SqlglotBridge pair, the surface `idGenerator`s,
   `examples/output/`).
4. **Guard the union** -- exhaustiveness (`assertNever`, typed
   `Record`) so vocabulary growth breaks the build instead of
   degrading silently.

This spec designs the machinery for 3 and 4 and the enforcement-layer
repairs beneath everything (the depcruise gate); it deliberately does
**not** decide the per-finding share-vs-derive calls, which are
individual changes with their own blast radii, routed through the
audit's Follow-up index.

## Should the guard be deduplication instead of checking? (resolved: no)

The direct reading of the audit is "extract the copies". Rejected as
the primary move, for the reason the principles already state: several
of the worst pairs are deliberately parallel (`SqlglotBridge`,
`projectLoader`) and coupling them costs more than the duplication.
The insight from the guarded regeneration family is that **the check
is the cheap, universal move and the share is a case-by-case
optimization**: a parity test over two byte-identical files costs a
manifest line and forbids nothing about the design, while an
extraction is a design change each time. Checking first also converts
every later share into a safe refactor -- the check is the test that
the share preserved behavior.

## Scope

In scope:

- When `npm run check:parity` runs, the system shall compare every
  pair (or set) of source spans declared in the parity manifest and
  exit nonzero naming each set whose members differ.
- When a manifest entry names a file or exported symbol that does not
  resolve, the check shall fail loudly (a stale manifest is itself
  drift).
- When CI runs, the system shall run `check:parity` alongside lint.
- When a source file imports a `@barwise/*` subpath, the dependency
  gate (`npm run depcruise`) shall resolve the edge and enforce the
  one-way graph over it.
- When the root `CLAUDE.md` graph, `.dependency-cruiser.cjs`, and the
  packages' `package.json` dependencies disagree, at least one check
  in the repo shall fail.
- When `npm run regen:examples` runs on a clean tree, the system
  shall produce no diff; when the committed `examples/output/`
  artifacts differ from what regeneration produces, a test shall
  fail.
- When a switch over a core vocabulary union omits a member and the
  code's intent is exhaustive handling, the system shall fail to
  compile (via `assertNever` from `@barwise/core`).
- When `npm run audit:duplication` runs twice over the same tree, the
  system shall emit byte-identical candidate reports (detection is
  deterministic; only classification is judgment).
- When `audit:duplication --check` runs, the system shall fail on any
  candidate absent from the committed baseline and on any baseline
  entry no longer detected, so the baseline's `tracked` entries
  always enumerate exactly the detectable findings still open.
- When a contributor adds a copy that must agree with existing code,
  the convention (root `CLAUDE.md`) shall direct them to share,
  derive, register the pair in the manifest, or add a drift test in
  the same commit.

Out of scope, deferred and named:

- **Behavioral parity tests** (two implementations agreeing on
  outputs, not bytes). The manifest asserts source identity; where a
  pair later diverges deliberately, its entry is replaced by a
  behavioral test designed for that pair. Named per-pair in the
  Follow-up index.
- **The share/derive remediations of individual audit findings**
  (B1-B7, the registry-derivation work, `FormatDescriptor.extension`).
  Each is its own change with its own review; this spec only
  guarantees they cannot regress silently once made.
- **Generating docs from code** beyond the three aggregator
  dependency tables (Open decision 3). Doc completeness (`MCP.md`,
  `CLI.md`) is editorial work, not guard machinery.
- **Mutation testing** for tests that pass for the wrong reason
  (barwise-859's territory, unchanged).

## Inventory

| Area                                              | Current state                                                  | Verdict                                        |
| ------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| `scripts/check-parity.mjs`                        | Does not exist; the drift check                                | new (W2)                                       |
| `parity.manifest.json` (repo `barwise/`)          | Does not exist; the declared must-agree sets                   | new (W2)                                       |
| `tsconfig.depcruise.json`                         | Wildcard `paths` swallows subpaths; 80 edges invisible         | modify (W1)                                    |
| `.dependency-cruiser.cjs`                         | Hand-copied graph, missing `diagram-ui` edges; stale spec path | modify (W1)                                    |
| Root `CLAUDE.md` dependency graph                 | Missing `diagram-ui` on `cli`/`mcp` rows                       | modify (W1)                                    |
| `packages/core/src/util/assertNever.ts`           | Does not exist; no exhaustiveness helper anywhere              | new (W3)                                       |
| `packages/core/src/index.ts`                      | Gains the `assertNever` export                                 | modify (W3)                                    |
| Unguarded vocabulary switches (audit class D)     | `default`-fallthrough or void-context switches                 | modify (W3)                                    |
| `scripts/regen-example-output.sh`                 | One of two disagreeing regenerators                            | modify (W4)                                    |
| `packages/llm/tests/Pipeline.integration.test.ts` | The other regenerator (`UPDATE_GOLDEN=1`)                      | modify (W4)                                    |
| `examples/README.md`                              | Claims a version stamp the files do not carry                  | modify (W4)                                    |
| `scripts/audit-duplication.mjs`                   | Does not exist; the sweep's deterministic detection half       | new (W5)                                       |
| `audit-baseline.json` (repo `barwise/`)           | Does not exist; classified candidates, the unaddressed ledger  | new (W5)                                       |
| Root `CLAUDE.md` Conventions                      | No rule about must-agree copies                                | modify (W6)                                    |
| `.claude/skills/spec-writer/` pre-push gate       | No parity item                                                 | modify (W6)                                    |
| `.claude/skills/duplication-audit/`               | Carries detection as prose; shrinks to judgment once W5 lands  | modify (W5)                                    |
| `packages/*/src` byte-identical pairs (audit C)   | Agree by construction                                          | untouched (W2 registers them; no source edits) |

`turbo.json` is untouched: `check:parity` and `depcruise` are
root-level scripts like `fmt:check`, not per-package tasks. The
audit's class B (already-diverged copies) is deliberately absent from
this table -- reconciling diverged copies changes behavior and each
goes through its own change; W2 only registers pairs that agree
today.

## Target architecture

```
barwise/
  parity.manifest.json        the declared must-agree sets, e.g.:
    {
      "sets": [
        { "name": "surface-id-generator",
          "why": "ids from all three surfaces sort together",
          "members": [
            "packages/cli/src/workspace/idGenerator.ts",
            "packages/mcp/src/workspace/idGenerator.ts",
            "packages/vscode/src/client/idGenerator.ts" ] },
        { "name": "sqlglot-bridge",
          "why": "same SQL parses the same way whichever connector asks",
          "ignore": "leading-docblock",
          "members": [
            "packages/formats/src/sql/SqlglotBridge.ts",
            "packages/dbt/src/sql/SqlglotBridge.ts" ] },
        { "name": "pascal-case-avro",
          "why": "record names must align between mapper and exporter",
          "members": [
            { "file": "packages/core/src/mapping/renderers/avro.ts",
              "symbol": "toPascalCase" },
            { "file": "packages/formats/src/avro/AvroExportFormat.ts",
              "symbol": "toPascalCase" } ] }
      ]
    }

  scripts/check-parity.mjs    loads the manifest; whole-file members
                              compare by normalized text, symbol
                              members are extracted with the
                              TypeScript compiler API (already a
                              devDependency) and compared by printed
                              AST text, so formatting and the one
                              permitted docblock difference do not
                              false-positive; unresolvable member -> error

  scripts/audit-duplication.mjs
                              the sweep's detection half, deterministic:
                              emits the candidate report (duplicate
                              literals, union restatements, parity-claim
                              prose, generated files and their guards,
                              clone runs) for an auditor to classify;
                              --check diffs the report against the
                              baseline and fails both ways (new
                              unclassified candidate; stale entry)

  audit-baseline.json         every known candidate, stably keyed
                              (file + symbol or content hash, never
                              line numbers), each carrying its verdict:
                              accepted-benign, or tracked + bd issue id
                              -- the tracked entries ARE the open
                              findings list; cadence and detector
                              scope for CI: Open decision 5

  package.json                "check:parity": "node scripts/check-parity.mjs"
                              "audit:duplication": "node scripts/audit-duplication.mjs"
  .github/workflows/ci.yml    runs check:parity with lint

  tsconfig.depcruise.json     per-subpath paths entries (or a resolver
                              that strips the subpath before matching),
                              so @barwise/core/annotation et al.
                              resolve and the one-way rules see them

  @barwise/core
    util/assertNever.ts       export function assertNever(x: never): never
                              -- the standard never-guard; usable in void
                              switch contexts where TS2366 cannot fire
```

The manifest is itself a hand-maintained list -- the same species as
the capability matrix -- with two properties that matrix lacks: an
entry that stops resolving fails the build (staleness is loud), and
an entry that is present does its whole job mechanically. What the
manifest cannot do is know about pairs never registered; that is what
W6's convention line and the periodic re-sweep are for -- with W5
making the re-sweep's detection a deterministic script rather than a
procedure an agent re-interprets each run.

## Alternatives considered

- **Extract shared helpers instead of checking copies.** Rejected as
  the primary move; see the resolved question above. Individual
  extractions remain available afterward, made safe by the check.
- **jscpd (or clone detection generally) in CI as the guard.**
  Rejected: clone detectors report _presence_ of duplication, which
  this codebase deliberately permits, so the signal is all noise; and
  they go silent exactly when the defect fires (the moment a pair
  drifts, it stops being a clone). The manifest inverts this:
  declared pairs must stay identical; everything else is free.
- **A custom ESLint rule reading "Must match" comments.** Couples the
  guard to comment phrasing, cannot express cross-file sets, and
  leaves the two existing comments as the only registered pairs.
  The manifest supersedes the comments (W2 replaces them with
  manifest pointers).
- **Fix depcruise by banning subpath imports.** Would make the gate
  correct by shrinking the language, but `packages/core/CLAUDE.md`
  _mandates_ subpath imports for core capabilities, and the exports
  map is the real API. The gate must learn the house style, not veto
  it.
- **Generate the CLAUDE.md dependency graph from package.json.**
  Attractive symmetry with `regen:builtins`, but the graph prose
  carries annotations (the connector-convention notes) that a
  generator would flatten. W1 instead makes depcruise the checked
  mirror (it already claims to be) and keeps the prose hand-written;
  Open decision 3 carries the doc-table variant of this question.

## Workstreams (each independently shippable)

### 1. Make the dependency gate see what it claims to enforce

Fix `tsconfig.depcruise.json` so `@barwise/*` subpath imports resolve
(per-subpath `paths` entries for the nine core subpaths plus
`diagram/theme` and `diagram-ui/server`, or a strip-subpath resolver);
add `diagram-ui` to the `cli` and `mcp` rows in both the root
`CLAUDE.md` graph and `.dependency-cruiser.cjs`; fix the archived
spec path in its header. Add a hostile-import probe test (a fixture
cruise, or a temporary import in CI) proving the gate now reports a
forbidden subpath edge.

Acceptance: when depcruise runs over the current tree, the system
shall report zero violations while resolving the 80 subpath edges
(verified by edge count in the depcruise JSON); when a
`@barwise/llm/...` subpath import is introduced into
`packages/core/src`, depcruise shall fail.

First because it is the enforcement layer under everything else, and
because the graph correction is wrong to ship while the gate that
"enforces" the graph cannot see the edges that contradict it.

### 2. The parity manifest and `check:parity`

Add `parity.manifest.json` and `scripts/check-parity.mjs`; wire into
CI and the root scripts. Seed with the audit's class-C sets that are
byte-identical today and carry no behavioral reason to differ:
C1 (SqlglotBridge, docblock-ignored), C2 (both `toPascalCase` pairs,
by symbol), C3 (`quoteIdent`), C4 (`idGenerator` x3), C6
(`formatReview`, by symbol, once W2 confirms extraction is not
preferred -- see Open decision 2), C7 (`summarizeDiff`), C8
(`extractModel`), C9 (diff projection, by symbol). Replace the two
"Must match" comments with pointers to the manifest entry. No source
logic changes in this workstream.

Acceptance: when any registered member is edited without its
partners, CI shall fail naming the set; when a registered file or
symbol is renamed away, CI shall fail; when `check:parity` passes,
re-running it shall be idempotent and fast (< 5s, no build required).

### 3. `assertNever`, and the unions the audit named

Export `assertNever` from `@barwise/core`; apply it (or a typed
`Record`/derivation) to the class-D sites where exhaustive handling
is the intent: the ring validation switch, `CounterexampleGenerator`,
`NormaXmlParser.normalizeRingType` (reject, do not coerce -- an
unrecognized ring type becoming `irreflexive` is a silent semantic
rewrite), the `InferredConstraintType` `ALL` array (derive from a
`Record<InferredConstraintType, true>` so completeness is
type-checked), promptlab's gym-check-kind array (derive from the
imported type the same way), and `RelationalMapper.conceptualTypeToSql`
(drop the unreachable `default`). Sites where partial handling is
deliberate (`ModelToGraph`, lineage labels, the phase2 verbalizer's
open default) are Open decision 1, not silent conversions.

Acceptance: when a member is added to `RingType`,
`InferredConstraintType`, or `ConceptualDataTypeName`, the build
shall fail in every package whose handling of the union is declared
exhaustive; when NORMA import meets an unrecognized ring type, the
system shall reject with a diagnostic rather than coerce.

(provisional: not yet grounded -- the exact site list needs re-reading
each switch's intent during implementation; treat the enumeration
above as the audit's candidates, not a settled edit list.)

### 4. One regenerator and a drift test for `examples/output/`

Collapse the two regenerators: the vitest `UPDATE_GOLDEN` path becomes
the single writer (it shares code with the pipeline it snapshots,
matching the `regen-references.mjs` precedent), and
`regen:examples` either delegates to it or is removed;
`examples/README.md` stops claiming a version stamp or the stamp is
reintroduced in the one writer. Add the drift test the four citations
already believe exists: regenerate in-memory, byte-compare against
the committed files.

Acceptance: when the committed `examples/output/` files differ from
regeneration output, the suite shall fail; when the documented
regeneration command runs on a clean tree, `git status` shall be
clean; when the four citing sites are read, each shall point at a
guard that exists.

### 5. Mechanize the sweep's detection half

The audit's five passes divide cleanly into deterministic detection
and human classification, and only the second belongs in skill prose.
Add `scripts/audit-duplication.mjs` (`npm run audit:duplication`)
covering the detection that is mechanical: cross-file duplicate
string-literal extraction, union-restatement candidates (bare enums,
`Set`/array re-listings, and switches over each core union, flagged
with their guard shape), the parity-claim grep vocabulary over docs
and CLAUDE.md files, the generated-file inventory with each file's
regeneration script and guard-test presence, and the jscpd run with
pinned flags. The script emits a candidate report (stable order,
stable format -- same tree, same bytes); it assigns no verdicts.
Classification against the rubric stays with the auditor.

What makes the report _gateable_ despite that is a committed
baseline, `audit-baseline.json`: every known candidate keyed by a
stable identity (file plus symbol or content hash -- never line
numbers, which churn) and carrying its classification --
`accepted-benign`, or `tracked` with the bd issue id. Then
`audit:duplication --check` diffs the fresh report against the
baseline and fails in both directions: a candidate absent from the
baseline is new, unclassified duplication (classify it: share,
derive, register, accept); a baseline entry no longer detected is a
resolved finding whose entry must be removed and issue closed. This
is the ratchet that answers "which findings are unaddressed": at any
moment, the `tracked` entries _are_ the open list, and the baseline
cannot silently rot in either direction -- the same staleness-is-loud
property the parity manifest has. The jscpd-in-CI rejection in
Alternatives stands for raw detection (candidates are not findings);
the baseline diff is sound to gate on precisely because every gated
item carries a verdict someone assigned once. Cost is not the
concern it appears: detection is seconds against a CI that builds 12
packages and runs the full suite -- the per-PR cost is baseline-touch
_friction_ from the fuzzier detectors, which is why cadence and
detector scope are Open decision 5, not decided here.

Rewrite the `duplication-audit` skill's method section to run the
script for detection and keep only the judgment layer: the rubric,
verification discipline, and the findings-doc format. Passes that
are inherently judgment (cross-surface wiring comparison,
semantic-clone shape hunts) stay in the skill, seeded by the
script's candidates.

Acceptance: when `audit:duplication` runs twice on one tree, the
reports shall be byte-identical; when it runs on the audit's tree, it
shall surface the class-B/C/D candidates the audit found by hand
(spot-checked against the audit doc); when `--check` runs against a
tree containing a candidate absent from the baseline, it shall exit
nonzero naming it; when `--check` runs after a baselined candidate
is resolved, it shall exit nonzero naming the stale entry; when the
baseline is read, its `tracked` entries shall enumerate exactly the
detectable findings still open; and when the skill's method section
is read, detection shall be one command, not a grep procedure.

### 6. Write the rule where authors will meet it

Add the invariant to root `CLAUDE.md` Conventions ("a copy that must
agree with other code is shared, derived, registered in
`parity.manifest.json`, or drift-tested in the same commit -- a 'must
match' comment is not a check") and a matching item to the
spec-writer pre-push design gate. Point both at the
`duplication-audit` skill for the re-sweep method.

Acceptance: when the Conventions section is read, it shall carry the
rule and name the manifest; when the spec-writer gate is run, it
shall ask the parity question.

Last because its content depends on the mechanisms of W1-W5 existing
under the names it cites.

## API and migration impact

- `@barwise/core` gains one export (`assertNever`). No other package
  API changes in any workstream; the manifest and script are
  repo-level tooling.
- No downstream package adds a dependency; the one-way graph is
  unchanged (W1 makes it _checked_, not different).
- CI gains one root-level step (`check:parity`, seconds); depcruise
  runtime is unchanged.
- W3 can surface latent build breaks in packages whose switches were
  silently non-exhaustive -- that is the point; each such break is a
  finding to resolve, not collateral.

## Open decisions (for review)

- **Which partial vocabulary handlers are deliberate?**
  `ModelToGraph` draws 6 of 16 constraint kinds; lineage labels 11 of
  16; the phase2 verbalizer's open default is clearly intentional.
  Options: (1) declare intent in code -- each partial handler lists
  the members it deliberately ignores in a typed
  `Record<Ignored, "not-drawn" | ...>` so a new member forces a
  choice; (2) leave them open and record the gap in the package
  CLAUDE.md; (3) make them exhaustive. Recommend 1 for diagram and
  lineage (the silent 5-of-16 gap is exactly how users lose
  constraints from diagrams today) and 2 for display-only sites.
- **Check `formatReview` or share it?** The MCP and VS Code review
  renderers are identical because VS Code only needed a different
  client. Sharing (export `formatReview` from `@barwise/mcp`, which
  vscode already depends on) is a two-line change with no new
  coupling; checking preserves the status quo. Recommend share --
  this is the case where the hierarchy's step 1 costs nothing -- and
  register nothing; but the reviewer may prefer the zero-code-change
  manifest entry first.
- **Do the aggregator dependency tables get generated?** The `cli`,
  `mcp`, `vscode` CLAUDE.md dependency lists are wrong today and are
  mechanical facts. Options: generate them from `package.json` with a
  drift test (the `regen:builtins` pattern, cheap and durable), or
  correct them by hand and accept recurrence. Recommend generate for
  the three tables only; the prose around them stays hand-written.
- **Manifest granularity for near-identical pairs.** The counterexample
  renderer pair differs by two blank lines; the analyze guard message
  pair diverges deliberately in its remediation clause. Options: a
  per-entry `ignore` vocabulary (docblock, blank-lines, marked
  spans), or requiring exact identity and excluding such pairs.
  Recommend the small `ignore` vocabulary, capped at those named
  forms -- an open-ended normalizer would slowly stop checking
  anything.
- **Baseline-ratchet cadence and detector scope.** Detection is cheap
  (seconds); the per-PR cost is baseline-touch friction, and it is
  not uniform across detectors. Options: (1) full `--check` on every
  PR -- maximum catch-at-introduction, but the fuzzy detectors (clone
  runs, prose-claim greps) will force baseline edits for incidental
  hits and teach contributors to resent the gate; (2) split by
  signal-to-noise **(recommended)** -- per-PR `--check` over the crisp
  detectors only (duplicate literals above threshold, union
  restatements, generated-files-without-guards), with the full sweep
  including jscpd and prose passes on a schedule (weekly or
  pre-release, diffed against the same baseline); (3) scheduled-only
  -- zero PR friction, but new duplication lands unclassified for up
  to a cycle, which is the window the invariant exists to close. The
  trade is friction against catch-at-introduction; recommend 2, and
  revisit toward 1 only if the fuzzy detectors prove quieter than
  expected on real PRs.

## Risks and testing

- **False positives from formatting.** dprint formats TS uniformly and
  symbol members compare by printed AST, so formatting noise should
  not fire the check; W2's acceptance includes running `npm run fmt`
  and confirming `check:parity` still passes.
- **The manifest rots into noise.** Mitigated structurally: stale
  entries fail (unresolvable member -> error), and every entry carries
  a `why` so a future editor can retire it deliberately. Retiring an
  entry requires either a share/derive change or a behavioral parity
  test in the same commit -- the W6 convention states this.
- **W3 changes behavior at the NORMA coercion site.** Deliberate and
  called out; needs a fixture with an unknown ring type asserting the
  new rejection, and a check of round-trip tests that may have relied
  on the coercion.
- **W1 may reveal real graph violations** among the 80 hidden edges
  beyond the known `diagram-ui` pair. Each is a finding; the
  workstream does not ship with `depcruise` red, so discovery happens
  before the config lands.
- **Tripwires.** If `check:parity` needs an `ignore` form beyond the
  capped vocabulary, the pair is not a parity pair -- design a
  behavioral test or a share instead. If a manifest set keeps failing
  on legitimate edits, the copies have a real reason to differ and
  the entry is wrong, not the edit. If W3 turns up a union consumer
  whose partial handling nobody can classify as deliberate or not,
  that is an audit finding, not a judgment call to make inline.
- Full gate after each workstream: `npm run build`, `test`, `lint`,
  `depcruise`, `fmt:check` from `barwise/`.

## Non-goals

- No deduplication mandate: deliberately parallel copies stay
  parallel; this spec only makes their agreement checked.
- No reconciliation of already-diverged copies (audit class B) inside
  these workstreams -- each is its own behavioral change.
- No change to `resolveArtifact`/`selectArtifact`, the format
  registry's semantics, or any public API beyond the one core export.
- No doc-generation beyond the three dependency tables under Open
  decision 3.
- No new lint dependencies, clone detectors, or CI infrastructure
  beyond one node script.

## Implementation notes

All six workstreams landed, each with the artifact that proves it:

| WS | What it asked for                                 | Artifact                                                                                         |
| -- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1  | the dependency gate sees the subpath edges        | `scripts/check-depcruise-gate.mjs` -- subpath coverage plus a hostile-import probe, gated in CI  |
| 2  | registered must-agree copies fail on drift        | `parity.manifest.json` + `scripts/check-parity.mjs`                                              |
| 3  | exhaustiveness for the vocabulary unions          | `packages/core/src/util/assertNever.ts`                                                          |
| 4  | one regenerator and a drift test for the examples | `scripts/regen-example-output.sh` + `packages/core/tests/integration/exampleOutputDrift.test.ts` |
| 5  | mechanize the sweep's detection half              | `scripts/audit-duplication.mjs` + `audit-baseline.json`                                          |
| 6  | write the rule where authors meet it              | the must-agree rule in the root `CLAUDE.md`                                                      |

The header read "Draft for review (design only -- no implementation in
this PR)" until 2026-08-30, while CLAUDE.md cited the ratchet this spec
designed as landed and gated in CI. It was found by `npm run
audit:specs`, which exists because of it (barwise-910) -- and the
template that supplied that default now says something about the spec
rather than about a pull request, so the next one does not start life
with a claim that expires on merge.
