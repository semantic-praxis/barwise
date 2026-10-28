# Executable ADRs: each ADR declares what enforces it, and CI checks the declaration

Status: Draft -- no workstream implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-ym8
Touches: barwise/scripts/check-architecture.mjs,
barwise/scripts/lib/architecture-section.mjs,
+barwise/scripts/lib/adr-enforcement.mjs, barwise/scripts/lib/ci-gates.mjs,
barwise/scripts/mutate.mjs, barwise/scripts/fault-matrix.mjs,
barwise/scripts/tests/,
barwise/docs/adr/, barwise/docs/ARCHITECTURE.md,
.claude/skills/spec-writer/template.adr.md

In one sentence: every ADR carries an `Enforced-by:` header naming the
CI steps, hooks and test files that enforce it, or `none` with an open
issue; `npm run check:architecture` fails when a named enforcer does not
exist or does not run, and when an ADR declares nothing.

## Principle

Explicit over implicit, and findings close by mechanism
(`docs/adr/findings-close-by-mechanism.md`). Almost every ADR already
names its enforcer, but only in Consequences prose, which no tool reads.
So the claim "this decision is enforced by `npm run purity`" survives
the gate being renamed, deleted, or dropped from `ci.yml`, and the ADR
goes on describing a system that no longer exists. That is the silent
decay the ADR convention was meant to end, moved one level down: the
decision text is checked (`check:architecture` validates each ADR's
shape and every reference to it), and the link from decision to enforcer
is not.

The idea comes from the Aver language, which makes decisions a parse
node its tooling can index rather than prose it cannot see
(`aver context --decisions-only`). Aver's records list the components a
decision impacts, and, as far as its published decisions document shows,
nothing checks those names against the code. This spec takes Aver's half
-- the decision is data the tooling reads -- and adds the half it lacks:
the enforcer named in that data is verified to exist and run.

## What does "executable" buy, and what does it not? (resolved: existence and wiring, not discrimination)

The check proves the named enforcer exists and runs in CI. It does not
prove the enforcer would fail on a violation of the decision. In root
`CLAUDE.md`'s terms, a gate that exists and runs is the shadow; a gate
that goes red when the decision is broken is the property. This spec
ratchets on what can be checked cheaply on every PR (the shadow's
preconditions: no named enforcer is missing or unwired), and puts the
property in workstream 4, an on-demand probe in the shape of
`npm run fault-matrix`, which is not a CI gate. Gating CI on the shadow
alone is safe here because the shadow is not used as evidence that an
ADR is respected; it only stops the ADR from claiming an enforcer that
is gone. WS3's index keeps to that: it labels the list `declared`, and
its section header says a declared enforcer exists and runs, not that
it catches a violation.

## Scope

In scope:

- When an ADR under `barwise/docs/adr/` has no `Enforced-by:` header
  line, or one whose value parses to zero entries, `check:architecture`
  shall exit 1 naming the file. An empty line declares nothing, as an
  absent one does; the existing `Date:` check already treats empty that
  way.
- When an `Enforced-by:` entry names `npm run <script> [-- <args>]`, the
  check shall exit 1 unless `<script>` is a key of `barwise/package.json`
  `scripts` and some `ci.yml` step, as `ciSteps()` in
  `barwise/scripts/lib/ci-gates.mjs` returns it, runs that root script
  with exactly those arguments. The arguments are part of the match
  because they can be what makes a step a gate: `audit:specs`,
  `audit:duplication` and `audit:corrections` fail CI only under
  `-- --check`, so a step edited to drop it must stop counting. The
  entry is written as CI writes the step, `npm run audit:specs --
  --check`.
  What a step runs is decided by one new function, `stepScript(args)` in
  `ci-gates.mjs`, returning `{ script, args }` or null. It splits at the
  first `--`. Before it, the first token must be the npm subcommand `run`
  (or its alias `run-script`), so `npm audit` never counts as the
  `audit` script. Any token whose name, the part before `=`, is
  `--workspace`, `--workspaces`, `-w`, `-ws`, `--prefix` or `-C` makes
  the answer null, wherever it sits before `--`: those run another
  package.json. Other flags (any token starting with `-`) are skipped,
  and the first remaining token is the script. After `--`, the tokens are
  the arguments.
  `resolveNodeGate()` in `scripts/fault-matrix.mjs` names a step's
  script with its own inline rule today; WS1 makes it take the name from
  `stepScript()` and return null when that does, before its own
  node-gate resolution, so the naming cannot drift. The two are not
  identical functions: `resolveNodeGate` also returns null for every
  script that is not a single node gate (`lint`, `build`, `dup`), so the
  pinned property is that wherever `resolveNodeGate` names a script,
  `stepScript` names the same one, over every `ci.yml` step. One
  behaviour changes on purpose: a step like `run --silent x` would
  become auditable by `fault-matrix`, where today it is skipped; no
  `ci.yml` step has that form now. No ADR relies on a workspace step
  today.
- A step marked `continue-on-error: true` is not wired: it cannot fail
  CI. `ciSteps()` does not report that key today, so WS1 extends it to
  return `continueOnError` beside `condition`; `ci:local` and
  `fault-matrix` do not use the new field in this spec (`ci:local`
  still runs `dup` and `filesize` as blocking, a divergence from CI
  filed separately as barwise-4vj), and the shape pinned by
  `scripts/tests/ci-conditions.test.mjs` is updated with it. Where the
  same arguments appear in two steps, `ciSteps()` keeps one entry, and
  its `continueOnError` is true only if every occurrence has the key,
  so step order cannot decide whether a gate is wired. Separately,
  `npm run dup` and `npm run filesize` each run once in `ci.yml`, with
  `continue-on-error: true`, and `must-agree-copies` names `dup` in its
  prose, so WS2 must not declare it.
- A step guarded by an `if:` counts as wired. Most guards are
  `docs_only != 'true'`, which skips only changes that cannot violate a
  code decision; the narrower ones (`test:optimizer`, `pull_request`
  only) enforce on exactly the changes CI's classifier sends them, and
  the classifier is the authority on that, not this check. An ADR whose
  enforcer is narrowly guarded says so in its Consequences.
- When an entry names a hook, it takes one of two forms, and the check
  shall exit 1 unless its conditions hold.
  `hook <Event> <path>`: the path is tracked, and `.claude/settings.json`,
  parsed as JSON, has an entry under `hooks.<Event>` whose nested
  `hooks` list holds a `command` that runs the path (the real shape is
  `hooks.<Event>[i].hooks[j].command`). Runs means the command's first
  word is `node` followed by the path, or is the path itself (as
  `.claude/hooks/session-start.sh` is run), after an optional `env`
  prefix: `env`, then its options, where `-u` and `--unset` consume the
  next token as a variable name (every hook here is `env -u
  BARWISE_EXIT_DIR node ...`), then any `NAME=VALUE` assignments. The
  path may be
  quoted and prefixed with `$CLAUDE_PROJECT_DIR/`, and is followed by a
  quote, whitespace or the end. So `echo <path>`, `echo node <path>` and
  `node <path>.disabled` do not count, the same strictness as the husky
  rule below. A path that survives only in a permission rule, or
  under another event, does not count. The entry's `matcher` is not
  checked; a matcher that never fires is the kind of defect WS4's
  probes are for.
  `hook barwise/.husky/<name> runs npm run <script>`: the husky file is
  tracked, `<script>` is a key of `barwise/package.json` `scripts`, and
  the husky file has a line that invokes the script in one of two
  shapes, and no other shape counts. Either the line is the invocation
  alone -- `npm run`, flags as defined for CI steps above, `<script>`,
  optional `-- <args>` -- optionally followed by `|| exit $?` or
  `|| exit <non-zero literal>`; or it is `if ! <invocation>; then`, and
  the `if` block it opens contains `exit $?` or `exit <non-zero
  literal>` before its `fi`. That is a whitelist rather than a list of
  forbidden suffixes, because the ways to discard a status (`| tee`,
  `|| echo`, a trailing `&`, an `if` block with no exit) are open-ended,
  and root `CLAUDE.md` already names the pipe case: a gate's status
  read through a pipe is the pipe's. It mirrors the rule that a
  `continue-on-error` CI step is not
  wired. Comment lines and `echo` strings therefore never match: `barwise/.husky/pre-push` names `npm run ci:local` in an echo
  as well as on the line that runs it. Naming the husky file alone is
  not accepted: it would pass however the hook's body changed, which is
  the decay this spec exists to catch. Both rules are lexical; they show
  the hook is wired and invokes the script, not that the line is
  reachable, which again is WS4's question.
- When an entry names a test file, the check shall exit 1 unless the
  path is tracked and a CI step runs its suite. Two places qualify. A
  `.test.mjs` directly in `barwise/scripts/tests/` (not a subdirectory:
  `run-script-tests.mjs` reads that directory with a non-recursive
  `readdirSync`), with `test:scripts` wired as above. Or a file under
  `barwise/packages/<pkg>/` that matches that package's test include --
  the `testInclude` literal in its `vitest.config.ts`, else the default
  `tests/**/*.test.ts` in `barwise/vitest.shared.ts`, or the
  `typecheck.include` literal where the config has one (core runs
  `tests/types/**/*.test-d.ts` that way) -- where the package
  defines `test:coverage` and the root `test:coverage` is wired as above.
  Tracked is not enough: `packages/vscode/tests/integration/` is tracked,
  vscode's `testInclude` is `tests/unit/**/*.test.ts`, and no `ci.yml`
  step runs the integration suite. The two arrays are read by key path,
  not by the first `include:` the reader meets: `testInclude` as a
  property of the options object passed to `barwiseVitestConfig`, and
  `include` inside its `typecheck` object. `named-files` packages
  (vscode, diagram-ui) also have a `coverage.include`, which is never
  read as a test list. A config where either key is present but is not a
  string-array literal is a refusal (exit 2), not a pass. Other suites CI runs (`test:trial`,
  `test:optimizer`) are declared by their npm script.
  Both discovery rules restate code owned elsewhere -- the
  non-recursive `.test.mjs` filter in `run-script-tests.mjs` and the
  default include in `vitest.shared.ts` -- so WS1 adds a drift test in
  `gates.test.mjs` that reads both sources and fails when either differs
  from what the check assumes, per `docs/adr/must-agree-copies.md`.
- When an entry is `none (deliberate: <reason>)`, the check shall accept
  it with no tracker lookup -- subject to the Open decision on that form,
  which WS1 waits on. The parser tries this form first, so `deliberate`
  is never read as an issue id.
- When an entry is `none (<issue-id>[: <which decisions>])`, the check
  shall exit 1 unless `<issue-id>` exists in `.beads/issues.jsonl` with
  a status other than `closed`. Each `none` names a gap issue, one whose
  title is the missing enforcer, never an umbrella issue that can close
  for unrelated reasons. The order that keeps CI green: the PR that
  builds an enforcer also replaces the ADR's `none` entry with it, and
  the gap issue closes afterwards in a tracker-only PR, as
  `check:tracker-closes` requires. Closing a gap issue while the ADR
  still says `none` fails the check, which is intended: it means the
  enforcer was never declared.
- When the check needs an input (`ci.yml`, `barwise/package.json`, the
  tracker, `.claude/settings.json`, `barwise/.husky/`, a
  `vitest.config.ts`) and cannot read it, it shall exit 2, per
  `docs/adr/gate-refusal-contract.md`. Every input is read under
  `--root` (`ciSteps(join(root, ".github/workflows/ci.yml"))`, not the
  default `WORKFLOW` path), and only when an entry of the kind that
  needs it is present, so the existing `check:architecture` fixtures in
  `gates.test.mjs`, which carry none of these files, stay green through
  WS1. They do not stay green through WS2 on their own:
  `architectureRepo()` copies every real ADR into the fixture, so once
  the real ADRs carry entries, the fixture needs the inputs those
  entries read. WS2 owns that change.
- When `npm run regen:architecture` renders the generated section of
  `barwise/docs/ARCHITECTURE.md`, each ADR line shall show its declared
  enforcers or `unenforced`, so a reader (or an agent session) sees
  which decisions name a guard without opening twenty files.

Out of scope:

- Rewriting Consequences prose. The prose keeps the reasoning and the
  gaps; the header is the list a tool reads. They overlap by design (see
  Open decisions, "Does the header duplicate Consequences?").
- Proving discrimination on every PR (workstream 4 is on demand).

## Inventory

Grounded 2026-10-28 by extracting the npm scripts each ADR names and
resolving them against `package.json` and `ciSteps()`.

| ADR                            | Enforcers named in prose today                                     | Declared state after WS2                                                    |
| ------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `baselines-merge-on-write`     | `audit:specs`, `test:scripts`                                      | enforced; `trial:gate` writer is barwise-tko                                |
| `connector-packages`           | `purity`, `depcruise`                                              | enforced                                                                    |
| `constraint-coverage-policy`   | none                                                               | `none (deliberate: ...)`, per Open decisions                                |
| `credential-handling`          | `check:secrets`, gitleaks pre-commit hook                          | enforced, incl. `hook barwise/.husky/pre-commit runs npm run check:secrets` |
| `determinism-in-core`          | `purity`                                                           | enforced                                                                    |
| `findings-close-by-mechanism`  | `audit:specs`, `audit:duplication`, `audit:corrections`, others    | enforced                                                                    |
| `gate-refusal-contract`        | `test:scripts`; `fault-matrix` is on demand                        | enforced                                                                    |
| `keyless-model-access`         | `test:coverage`, `depcruise`                                       | enforced: `depcruise` and named test files                                  |
| `merge-delegation`             | none; the ADR says so (barwise-zdd)                                | `none` per decision: zdd and new gap issues (WS2)                           |
| `metamodel-evolution-policy`   | none                                                               | to be determined in WS2                                                     |
| `must-agree-copies`            | `check:parity`, `audit:duplication`                                | enforced                                                                    |
| `ossie-interchange`            | `test:coverage`; decision 5 not built (barwise-wcg), 6 has no gate | named test files, plus `none` for 1 (part), 5, 6                            |
| `package-graph-authority`      | `check:architecture`, `depcruise`                                  | enforced                                                                    |
| `pinned-runtimes`              | `check:parity`; `check:pins` proposed, not built (barwise-920)     | enforced, plus `none` on a new gap issue                                    |
| `plan-before-code`             | `check:plan-review`, `check:spec-touches`                          | enforced                                                                    |
| `production-prompt-resolution` | `test:coverage`                                                    | enforced, by named test files                                               |
| `python-from-the-lockfile`     | `check:python-uv`, PreToolUse hook; `audit:skips` deferred         | enforced, plus `none` on a new gap issue                                    |
| `review-policy`                | `check:review-tiers`                                               | enforced                                                                    |
| `schema-versioning`            | `test:coverage`                                                    | enforced, by named test files                                               |
| `surface-capability-parity`    | `test:coverage` (the two `toEqual` tool-list tests)                | enforced, by named test files                                               |

What this shows:

- 17 of 20 ADRs already name an enforcer; the header makes that list
  checkable rather than new. Every npm script they name today exists and,
  except `ci:local`, `fault-matrix`, `plan-scope`, `pr:risk`, `prepare`,
  `regen:builtins` and `trial:gate`, runs in `ci.yml`, and `dup` runs
  only with `continue-on-error`. Those eight are not enforcers, and WS2 must not copy them into an
  `Enforced-by:` line: the check would correctly fail them. So nothing
  is broken now; the check is a ratchet against future drift.
- Two named checks do not exist (`check:pins`, `audit:skips`), and both
  ADRs already say so honestly. Each becomes a `none` entry on a new gap
  issue that WS2 opens as a child of the umbrella that proposed it
  (barwise-920, barwise-921, both open). Not the umbrellas themselves:
  barwise-921 is the whole uv rule, which can close while `audit:skips`
  stays unbuilt. WS3's index shows the gap beside the enforcers.
- `merge-delegation` has five decisions. Its Consequences say four are
  not enforced:
  1, 3 and 4 outright, and 2 only when the agent passes the SHA, with
  "Nothing requires the pin or the comment (barwise-zdd)". barwise-zdd is
  one mechanism (a check that the steward's review ran), so it cannot
  stand for all four: when it closes, the decisions it does not cover
  would lose their tracked gap. WS2 reads which decisions zdd covers and
  opens a gap issue for each one it does not, one `none` entry per
  issue. Decision 5, that the owner's instruction overrides the
  condition, is a grant of authority with nothing to check, and takes
  `none (deliberate: ...)`.
- The rule behind both rows, which WS2 applies to every ADR rather than
  only to the rows above: each decision that an ADR's own Consequences
  call unenforced, not built, review-only or without a gate gets a
  `none` entry. An ADR whose header lists enforcers and no gaps, while
  its prose names an unguarded decision, is the header-and-prose drift
  this spec exists to remove. `ossie-interchange` is the example the
  first Inventory pass missed: decision 5 is not built (barwise-wcg),
  decision 6 has no gate, and part of decision 1 is review-only.
- Five ADRs cite `test:coverage`, which runs every package test and so
  cannot point at one decision. Their entries name the test
  files that pin the decision instead (for example
  `barwise/packages/mcp/tests/serverSpawn.test.ts` for
  `surface-capability-parity`), which is both sharper and checkable.

Looks affected, is not: `scripts/lib/spec-reader.mjs` `header()` already
reads a multi-line header value from an ADR (the generated index uses it
for `Scope:` and `Date:`), so parsing needs no new reader.

## Target architecture

```
barwise/docs/adr/<concern>.md
  Scope: architecture
  Date: 2026-10-24
  Tracking: ...
  Enforced-by: npm run purity, npm run depcruise

barwise/scripts/lib/adr-enforcement.mjs       (new)
  parseEnforcedBy(text) -- the one parser of the header, used by the
                           check and by renderSection, so the index and
                           the check cannot disagree on an entry;
                           returns { entries, problems } and never
                           throws, because renderSection runs outside
                           the check's refusal handling and in
                           regen:architecture. The check reports the
                           problems; the index renders the entries
                           that parsed.
  splitEntries(value)   -- comma split outside parentheses, newlines
                           read as spaces; reports an unbalanced
                           parenthesis

barwise/scripts/check-architecture.mjs        (existing; one new pass)
  adrs           -- already read
  enforcement    -- new: resolve each parsed entry; runs after the
                    graph and ADR-shape passes, reads its inputs in its
                    own try, and an unreadable input there never hides
                    their findings
       uses ciSteps()        from scripts/lib/ci-gates.mjs   (existing)
       uses parseTracker()   from scripts/lib/beads-merge.mjs (existing)
       uses trackedPaths()   from scripts/lib/architecture-section.mjs
  every input read under --root, and only when an entry needs it
  exit 0 / 1 any finding / 2 a refusal and no finding

barwise/scripts/lib/architecture-section.mjs  (renderSection)
  - [Determinism in core](adr/determinism-in-core.md) -- 2026-10-24 -- declared: purity
  - [Pinned runtimes](adr/pinned-runtimes.md) -- 2026-08-30 -- declared: check:parity; gap: barwise-920.<new>
  - [Merge delegation](adr/merge-delegation.md) -- 2026-10-18 -- unenforced (barwise-zdd, ...)
```

Rendering rule: `declared: ` and the enforcers in declared order,
joined by `, `; then, after `; `, each `none` entry as `gap: <issue-id>`
or `gap: deliberate`, joined by `, `. (`barwise-920.<new>` above stands for
the child gap issue WS2 opens; its real id is minted then.) An ADR with
no `Enforced-by:` header, which WS1 still allows, renders with no
suffix at all, as today, so WS3 can land before WS2 finishes. An ADR with no
enforcer renders `unenforced (<issue-id or deliberate>, ...)` instead.
Each entry renders so its kind shows: `npm run x` as `x`; a husky
entry as `x (pre-commit hook)`; a settings hook as its file name
without extension and its event, `python-uv-guard (PreToolUse)`; a test
file as its file name. So credential-handling renders
`check:secrets, check:secrets (pre-commit hook)`, and a reader can tell
the CI scan from the local hook.

Entry grammar. Entries are separated by commas that sit outside
parentheses, so `none (barwise-zdd: decisions 1, 3)` is one entry; an
unbalanced parenthesis is a finding. A newline is read as a space, not
a separator: most entries contain spaces, and a header wrapped by hand
or by a reflow must not split `hook barwise/.husky/pre-commit runs npm
run check:secrets` in two. In exchange, every entry must match its form
exactly, and a token left over is a finding: `npm run purity npm run
depcruise`, a wrapped line whose comma was dropped, fails rather than
letting `purity` pass for both. An `<issue-id>` is `barwise-` followed
by `[a-z0-9]+(\.[a-z0-9]+)*`: `beads-crud create --parent` mints a
random three-character child suffix (`barwise-920.k3x`, via `mintId`
in `scripts/lib/beads-ids.mjs`), and older children are numeric
(`barwise-5t9.4`); either is one id, not an umbrella id plus text. Each entry is one of:

```
npm run <script>
npm run <script> -- <args>
hook barwise/.husky/<name> runs npm run <script> [-- <args>]   -- tried before the form below
hook <Event> <repo-rooted path>               -- Event is one word, no `/`; settings.json
<repo-rooted path to a test file>
none (deliberate: <reason>)                   -- per Open decisions; tried first
none (<issue-id>[: <free text naming which decisions>])
```

The split cannot reuse `touches()` in `spec-reader.mjs`, which splits on
every comma, nor `segments()` in `check-book-citations.mjs`, which splits
on one separator and clamps an unmatched `)` rather than reporting it.
`splitEntries()` is new and small; it need not agree with either.

## Alternatives considered

- **Decisions as structured data (YAML or a front-matter block), as
  Aver does in its own language.** It would make every field
  machine-read, not just the enforcer. It lost because it rewrites twenty
  ADRs and the tools that read them for a gain only the enforcer field
  needs today; one header line, read by the parser that already reads
  `Scope:` and `Date:`, gets the same check.
- **Infer the enforcer from Consequences prose** (the extraction used to
  ground the Inventory above). It needs no new field, but it is the
  inference "explicit over implicit" refuses: it cannot tell a gate the
  ADR relies on from one it mentions in passing (`ci:local`, named in
  seven ADRs, enforces none of them), and an ADR could stop naming its
  enforcer without the check noticing.
- **Map ADRs to gates from the gate side** (each check script declares
  the ADR it serves). It puts the link next to the code that enforces
  it, but an ADR with no enforcer has nowhere to say so, and "which
  decisions are unguarded" is the question this spec most needs to
  answer.

## Workstreams (each independently shippable)

### 1. The check, with an absent header allowed

Waits on the Open decision about `none (deliberate: ...)`, because the
grammar WS1 ships has to know whether that form exists.

Add `scripts/lib/adr-enforcement.mjs` (the header parser and the
entry splitter), then the enforcement pass to `check-architecture.mjs`,
validating every `Enforced-by:` entry that is
present. An ADR with no header is not yet a finding, so this lands green
before any ADR changes. Tests in `scripts/tests/gates.test.mjs`, beside
the existing `check-architecture` cases, cover each entry kind's pass
and fail, the parenthesized comma, a vscode integration-test path (fail),
the closed-issue case, and the exit-2 refusals; the fixture builder
gains `ci.yml`, `package.json`, tracker, settings and husky files only in
the cases that need them. The new cases change `gates.test.mjs`'s
registered test count, so WS1 also updates
`scripts/tests/expected-counts.json` (`npm run test:scripts -- --write`);
without it `test:scripts` refuses. First because it touches only the
checker, one new library and their tests.

The tracker is read with `parseTracker()` from `scripts/lib/beads-merge.mjs`,
which already exists and refuses malformed lines, missing ids and
duplicate ids. A duplicate id from a bad merge would otherwise resolve a
`none` entry against whichever record came first. No new tracker
reader is added. `beads-crud.mjs`, `check-tracker-closes.mjs` and
`audit-spec-status.mjs` keep their own inline parsers; converging them
is a separate `audit:duplication` question, not this spec's.

### 2. Backfill all twenty ADRs, then require the header

Add `Enforced-by:` to each ADR per the Inventory, replacing every
`test:coverage` citation with the test files that pin the decision.
Open the gap issues the Inventory calls for (children of barwise-920
and barwise-921). Where WS2 finds no enforcer for
`metamodel-evolution-policy`, it opens a gap issue for a `none` entry,
or uses the `deliberate` form if the decision admits no check. Extend
`architectureRepo()` in `gates.test.mjs`, which copies every real ADR
into its fixture, so the fixture also carries the inputs the real
entries read: `ci.yml`, the root `package.json`, the tracker, settings,
husky files, the vitest configs and the named test files. Without that,
every existing `check:architecture` case exits 2 once the ADRs carry
entries. The fixture is built and committed once per test file and
copied per case, so the tracker (over a megabyte) is not re-copied and
re-committed about ten times. The fixture's synthetic `ADR_OK` gains an `Enforced-by:` line
as well. In the same PR, run `npm run regen:architecture` if WS3 has
landed, since the backfill changes what the index renders, and make an
absent header a finding. Update `template.adr.md` so a new
ADR starts with the line. Coupled into one PR because requiring the
header without the backfill would turn CI red.

### 3. Show enforcement in the generated index

Extend `renderSection` per the rendering rule under Target architecture,
reading entries through `parseEnforcedBy()` rather than a second parser,
and regenerate `ARCHITECTURE.md`. Separate from
WS2 because it changes generated output a reviewer reads byte for byte.

### 4. Discrimination probes (provisional: not yet grounded)

For an ADR whose decision has a concrete violation, record one probe --
a file, a planted edit and the gate expected to go red -- and run it with
`scripts/mutate.mjs`, which already plants a mutation, runs a command
and reports whether it was caught. `mutate.mjs` counts any non-zero
exit as caught, so a probe that makes the gate refuse (exit 2) would pass
as discrimination; WS4 adds an expected-exit option to it and every
probe expects 1. A script runs every probe on demand,
as `fault-matrix` does for refusals. Not a CI gate: each probe is a full
gate run. Ungrounded: where probes live, and whether process ADRs
(`plan-before-code`) admit a plantable violation at all.

## API and migration impact

- No package changes; scripts, docs and one skill template only. No
  public API moves.
- `check:architecture` already runs in CI unguarded, so no `ci.yml`
  change and no new root forwarder.
- Every future ADR must carry the header, which `template.adr.md`
  states.

## Open decisions (for review)

- **Extend `check:architecture`, or a new `check:adr-enforcement`?** A
  new script keeps the package-graph check about the graph (orthogonality)
  and gives the failure its own name in CI; it costs a `ci.yml` step, a
  root forwarder and a second reader of the ADR set. Extending reuses the
  ADR reader and lives where the other ADR-shape checks already live.
  Recommend: extend, because the ADR checks are already in that script,
  and the graph check and ADR checks already report under separate
  headings. The cost of extending is coupling the graph gate to the
  tracker's and settings' health; the Target architecture contains it
  (the enforcement pass reads its inputs in its own try, after the other
  passes, and a refusal there never hides their findings). If the
  reviewer judges that containment not enough, the new script is the
  answer.
- **Should a `none` entry require an open issue?** Requiring it makes
  "unenforced" a tracked state that cannot outlive its issue silently,
  which is the point. The cost: a decision that is unenforceable by
  nature (`constraint-coverage-policy` is a trust statement) carries an
  issue that may never close. Alternative: allow `none (deliberate:
  <reason>)` with no issue. Recommend: allow both forms, so an honest
  "never checkable" does not need a fake open issue. This decision
  blocks WS1, whose grammar has to include or exclude the form.
- **Does the header duplicate Consequences?** Yes, partly: the
  enforcer's name appears in both. The header is checked and the prose is
  not, so the prose can still drift. Options: leave the prose as is, or
  have WS2 trim each Consequences to the reasoning and point at the
  header. Recommend: leave it; the prose explains what the gate covers
  and where it does not, which a list of names cannot.
- **Do test files earn a place in the grammar?** Without them, five ADRs
  could only cite `test:coverage`, which any PR runs and which cannot
  point at one decision. With them, a test can be renamed and the check
  catches it. Recommend: include them.

## Risks and testing

- The check must not pass vacuously. A parse that finds zero ADRs, zero
  `ci.yml` steps, or an empty tracker exits 2, not 0 (`ciSteps()` already
  throws on an empty workflow).
- WS1 tests run the check over temporary fixture trees (`--root`), as
  the existing `check-architecture` cases in `gates.test.mjs` do, and
  assert each failure kind's exit code directly: 1 for a finding, 2 for
  an unreadable input. `scripts/mutate.mjs` counts any non-zero exit as
  caught, so it cannot tell a finding from a refusal; it stays the
  reviewer's red-before-green demonstration, not the test. One case plants an input outside `--root`
  only (a real `ci.yml` step missing from the fixture's) to prove the
  check reads the fixture, not the checkout.
- Reading `testInclude` and `typecheck.include` out of a TypeScript
  config is a narrow parse. It is bounded by refusing (exit 2) either key
  when it is not a string-array literal, so a config rewritten into
  another shape stops the check rather than passing it.
- Free text inside a `none (...)` entry must not start a wrapped line
  with `Word: `, because `header()` ends a header value at such a line.
  The check reports the resulting unbalanced parenthesis with the hint
  that a wrapped line may have been read as a new header field.
- After WS2 and WS3, run `npm run check:architecture` and
  `npm run regen:architecture`, then `npm run ci:local`.

## Non-goals

- No change to what any ADR decides.
- No new gate for an unenforced decision. Where WS2 finds a decision
  with no enforcer, it records `none (<issue>)` and building the
  enforcer is that issue's work.
- No claim that a declared enforcer catches violations; that is WS4.
