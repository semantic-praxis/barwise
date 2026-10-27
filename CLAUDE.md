# CLAUDE.md

## Project: Barwise

An ORM 2 (Object-Role Modeling) toolkit for data engineers and
architects. Includes a VS Code extension, CLI tool, and MCP server.
Named after Jon Barwise, whose work on situation semantics
provides the theoretical foundation for fact-based modeling.

## Design Principles

- **Orthogonality (primary).** Each component addresses one concern
  and avoids hidden coupling to others. The package graph is one-way
  (core has no internal deps); validation, verbalization, mapping,
  diagram, and LLM live in separate modules. A change in one should
  not force changes in unrelated ones.

- **Composability (primary).** Capabilities are built from small,
  well-defined pieces that combine cleanly. One `@barwise/core`
  powers the CLI, MCP server, and VS Code extension; formats
  register through a single `FormatDescriptor` registry; LLM
  providers slot in via a factory. Prefer narrow primitives that
  compose over wide ones that don't.

- **Determinism in the core.** Validation, verbalization, mapping,
  diff, and query are pure and deterministic -- same input, same
  output. Non-determinism (LLM calls, network I/O, clocks) lives in
  the outer packages (`llm`, `cli`, `mcp`, `vscode`). New
  capabilities go in `core` only if they can preserve this; if they
  cannot, they belong one layer out (`docs/adr/determinism-in-core.md`).

- **Explicit over implicit.** Cross-domain references go through
  declared context mappings; data products declare the domains they
  compose; every `.orm.yaml` carries an `orm_version`
  (`docs/adr/schema-versioning.md`); import and export formats
  register through a named `FormatDescriptor` rather than being
  auto-discovered (`docs/adr/connector-packages.md`). When in doubt,
  require declaration instead of inference.

- **DRY (secondary).** Remove duplication when it does not
  compromise orthogonality or composability. A small amount of
  parallel code in two packages is preferable to an abstraction
  that couples them or forces one of them to bend its interface.
  When DRY conflicts with the primary principles, the duplication
  stays.

### Shared vocabulary (Ousterhout)

The principles above are the rules. These terms, from Ousterhout's
_A Philosophy of Software Design_, are shared words for discussing
them -- descriptive, not a further gate. A change is not rejected for
being a shallow module; the term just lets a reviewer say in two words
what would otherwise take a paragraph. Read the book for the argument;
what follows is only the vocabulary, anchored to this codebase.

- **Deep versus shallow modules.** A deep module hides substantial
  functionality behind a simple interface. This is what
  "narrow primitives that compose" is reaching for, stated from the
  caller's side. `resolveArtifact` and the `FormatDescriptor` registry
  are deep: small surface, real work behind it. A wrapper that renames
  three parameters is shallow -- it adds an interface to learn without
  removing anything to think about.

- **Complexity is what the reader pays**, in three forms worth naming
  separately: _change amplification_ (one decision edited in many
  places), _cognitive load_ (how much you must hold to make a change),
  and _unknown unknowns_ (you cannot tell what you needed to know).
  The third is the dangerous one and the hardest to see in review. It
  is what two recent specs kept hitting: nothing told a reader that the
  prompt variants had converged, or that the eval harness could not
  resolve the differences it was being used to rank.

- **Define errors out of existence.** Prefer designing away a failure
  case over requiring every caller to handle it. This is a deliberate
  counterweight to "explicit over implicit" above: taken alone, that
  principle can argue for pushing work onto callers, which is how a
  shallow interface gets justified. Explicit declaration is right for
  things a caller genuinely decides; it is wrong as a way to avoid
  solving something once, centrally. `runSuite` reporting its own
  resolvable difference rather than making every reader compute
  `SE * sqrt(2)` is this principle applied.

- **Comments describe what the code cannot.** Not what a line does --
  what a reader could not recover from the code: why a rule exists,
  what was tried and rejected, which failure a guard prevents. This is
  the criterion behind the comment style already used throughout.

- **The shadow and the property.** A cheap observable that correlates
  with the thing you care about, through some mechanism -- and that
  diverges from it exactly where the mechanism is bypassed, which is
  where the defect lives. Line count predicts defects because long
  functions thread mutable state, so a 959-line registry with no
  mutable parameters is a false positive
  (`functional-design-quality.spec.md`). Coverage predicts test
  effectiveness because executing code is a precondition for detecting
  a fault in it, so a test that executes and never asserts is the false
  positive (`test-quality.spec.md`). `numRuns: 250` represents evidence
  because each run is an independent trial, so 250 runs over inputs
  that cannot discriminate is one trial repeated
  (`pair-coverage-floors.spec.md`). A green run represents verification
  because the check would have reported failure -- barwise-906, six
  occurrences. The rule is **look at the shadow, ratchet on the
  property**: none of those specs deletes its shadow, they refuse to
  gate on it, because a gate is what adds the optimization pressure
  that turns structural divergence into Goodhart's law. This is not
  Goodhart by itself; the divergence is there before anyone games
  anything. Kitchenham, Pfleeger and Fenton (1995) name the underlying
  requirement -- a measure needs an attribute, a unit, an instrument,
  and a stated relation to an outcome -- and a shadow is an instrument
  whose relation holds only under a condition nobody wrote down.

- **Strategic over tactical, and design it twice.** Tactical work
  optimizes for getting this change in; strategic work leaves the
  design better than it found it. "Design it twice" -- develop two or
  three real alternatives before committing -- is already what the
  `spec-writer` skill's sensemaking step asks for, and naming the
  source ties them together.

## Essential Context

Read `barwise/docs/ARCHITECTURE.md` for the original system design,
metamodel specification, and phasing plan -- it is a historical design
record now (its repository-shape sections predate the 12-package
monorepo; its own header says what changed), except its first section,
"Current architecture", which is generated from the ADRs and the package
graph and checked in CI (`npm run regen:architecture`). The current structure
lives in this file and the per-package CLAUDE.md files below.

## Package-Specific Instructions

Each package has its own CLAUDE.md with dependency rules, layout,
commands, and testing conventions. Read the relevant file before
working in a package:

- `barwise/packages/core/CLAUDE.md` -- metamodel, validation, verbalization, serialization, mapping
- `barwise/packages/diagram/CLAUDE.md` -- diagram layout and SVG rendering
- `barwise/packages/diagram-ui/CLAUDE.md` -- React renderer (interactive canvas; headless SVG in WS3) over the diagram `PositionedGraph`
- `barwise/packages/llm/CLAUDE.md` -- LLM transcript extraction
- `barwise/packages/code-analysis/CLAUDE.md` -- code connector package; registers TypeScript/Java/Kotlin importers into the `FormatDescriptor` registry
- `barwise/packages/dbt/CLAUDE.md` -- dbt connector package; registers the dbt importer/exporter into the `FormatDescriptor` registry (owns its fs + subprocess I/O)
- `barwise/packages/formats/CLAUDE.md` -- standard interop connector package; registers the DDL/OpenAPI/Avro/NORMA/SQL/Ossie descriptors into the `FormatDescriptor` registry
- `barwise/packages/learn/CLAUDE.md` -- learning artifacts: the modeling gym (exercise format, deterministic evaluator, miss cards) and the tutorial renderer
- `barwise/packages/promptlab/CLAUDE.md` -- deterministic prompt evaluation: eval suite, scorer, runner, score history for the LLM surfaces
- `barwise/packages/cli/CLAUDE.md` -- CLI tool (the full command surface is the capability matrix below plus `barwise --help`; docs/CLI.md documents every command)
- `barwise/packages/mcp/CLAUDE.md` -- MCP server (tools, resources, prompts)
- `barwise/packages/vscode/CLAUDE.md` -- VS Code extension integration
- `barwise/optimizer/CLAUDE.md` -- the DSPy optimization lane (Python,
  offline, dev-time only; not an npm package and not a dependency
  of one)
- `AGENTS.md` -- General guidance on development practices.

## Dependency Graph

```
@barwise/core               (no internal deps)
  ^
  |--- @barwise/diagram         (core)
  |--- @barwise/diagram-ui      (diagram)  -- React renderer over the
  |                                           PositionedGraph; no elkjs,
  |                                           no VS Code
  |--- @barwise/llm             (core)
  |--- @barwise/code-analysis   (core)  -- connector package: registers
  |                                        code importers into the
  |                                        FormatDescriptor registry
  |--- @barwise/dbt             (core)  -- connector package: registers
  |                                        the dbt importer/exporter; owns
  |                                        its fs + subprocess I/O
  |--- @barwise/formats         (core)  -- connector package: registers
  |                                        the standard DDL/OpenAPI/Avro/
  |                                        NORMA/SQL/Ossie descriptors
  |--- @barwise/learn           (core)  -- learning artifacts: the modeling
  |                                        gym (exercise format, deterministic
  |                                        evaluator, miss-card emission) and
  |                                        the tutorial renderer
  |--- @barwise/promptlab       (core, llm, learn)  -- deterministic prompt
  |                                        evaluation: eval suite, scorer,
  |                                        runner, score history (the DSPy
  |                                        optimizer lane's metric)
  |--- @barwise/cli             (core, diagram, diagram-ui, llm, code-analysis, dbt, formats, learn, promptlab)
  |--- @barwise/mcp             (core, diagram, diagram-ui, llm, code-analysis, dbt, formats, learn)
  |--- barwise-vscode           (core, diagram, diagram-ui, llm, code-analysis, dbt, formats, mcp)
```

This block is a rendering for readers. The authority is `INTENDED` in
`barwise/scripts/lib/intended.cjs` (`docs/adr/package-graph-authority.md`);
`npm run check:architecture` fails when this block, or a package's
runtime `dependencies`, disagrees with it, so change both in one commit.
Draw it to the grammar in `barwise/scripts/check-architecture.mjs`
(`GRAMMAR`); a line outside it is refused by name.

The one thing outside that graph is `barwise/optimizer/`: the DSPy
prompt-optimization lane. It is Python, it is dev-time only, and it
depends on the workspace **as a subprocess** (`barwise prompt schema`,
`barwise prompt score`) rather than by import. Turborepo does not know
it exists; CI runs its offline suite (`npm run test:optimizer`) when
`optimizer/` or `packages/cli/` changes. Nothing there may become a runtime
dependency -- if a capability built in that lane turns out to be needed
at run time, it moves into `@barwise/llm` as TypeScript. That is the
determinism rule applied one layer further out than `core`.

Formats live in connector packages -- `@barwise/formats` (DDL, OpenAPI,
Avro, NORMA, SQL, Ossie), `@barwise/dbt` and `@barwise/code-analysis` --
which own their I/O and register through `registerStandardFormats()`,
`registerDbtFormats()` and code-analysis's own registration; core ships
no interop format (`docs/adr/connector-packages.md`).

Changes to `@barwise/core` can break all downstream packages. Run the
full monorepo build and tests after modifying core's public API.

## Current State

All development phases are complete; the full suite passes in CI
across all 12 packages.

### Capability matrix across the three surfaces

The surfaces do **not** all expose the same capabilities. Consult this
before assuming one is reachable from the surface you are working on.
An unmarked gap is a bug, and a change to a surface's reach updates this
table in the same commit. A VS Code "yes" means a palette command or a
language-model tool (the latter gated by `barwise.enableMcpServer`,
default on). The rules, what is pinned and what is not checked are in
`docs/adr/surface-capability-parity.md`.

| Capability                                            | CLI | MCP | VS Code | Divergence                                                                                                                                                                                     |
| ----------------------------------------------------- | --- | --- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| validate, verbalize, diagram, export, import, analyze | yes | yes | yes     | none                                                                                                                                                                                           |
| `review`                                              | yes | yes | yes     | none (VS Code as a language-model tool)                                                                                                                                                        |
| schema, diff, query, describe, lineage, impact        | yes | yes | yes     | none (VS Code as language-model tools)                                                                                                                                                         |
| `merge`                                               | yes | yes | yes     | deliberate: MCP and VS Code write back to the base file (editing tools); `barwise merge` never modifies its inputs                                                                             |
| `migrate`                                             | yes | no  | no      | deliberate: rewrites files in place, the one CLI command that modifies its inputs; MCP and VS Code write 3.0 on the next save of a file they edit                                              |
| `gym`                                                 | yes | yes | no      | deliberate: the editor has no exercise surface                                                                                                                                                 |
| `project split`                                       | yes | yes | yes     | none (VS Code as a language-model tool)                                                                                                                                                        |
| `project init`                                        | yes | no  | no      | under review: the surface audit, barwise-0wa                                                                                                                                                   |
| `history`                                             | yes | no  | no      | deliberate: repository operations (reads git)                                                                                                                                                  |
| `prompt`                                              | yes | no  | no      | deliberate: dev tooling                                                                                                                                                                        |
| `llm-usage`                                           | yes | no  | no      | deliberate: reads a local operator log                                                                                                                                                         |
| prompt-artifact override (`--artifacts`)              | yes | no  | no      | deliberate: candidates are measured, not sent                                                                                                                                                  |
| multi-sample import (`--samples`)                     | yes | yes | no      | deliberate: an editor wants one quick pass                                                                                                                                                     |
| thinking-budget override (`--thinking-budget`)        | yes | no  | no      | deliberate: an experiment dimension, recorded per history row                                                                                                                                  |
| reference inference (`--infer-references`)            | yes | no  | no      | deliberate: a warehouse-import option, no use elsewhere yet                                                                                                                                    |
| content-only matching on diff (`--matching content`)  | yes | yes | yes     | none on diff (VS Code as a language-model tool); merge stays id-first on every surface, since its id lookups assume a shared id is one element; its hazard under coinciding ids is barwise-xv1 |

Gaps marked `deliberate` are being re-decided under the owner's
2026-10-12 direction that MCP and VS Code mirror the CLI (barwise-0wa).
The MCP and VS Code tool lists are pinned by `toEqual` tests
(`mcp/tests/serverSpawn.test.ts`, `vscode/tests/unit/toolRegistration.test.ts`),
so adding a tool means updating that list and this table; the table
itself is maintained by hand, and nothing compares it with the code
(barwise-1005, barwise-xpt).

The `--artifacts` row hides a boundary within the CLI: `prompt eval`,
`prompt artifact` and `prompt run` accept unshipped prompt candidates;
`import transcript` and `review` must not, so the prompt any production
run sent stays recoverable (`docs/adr/production-prompt-resolution.md`).
Trying a candidate against a live model is `barwise prompt run`.

One name collision worth stating, because it looks like a gap and is
not: VS Code's `barwise.newProject` scaffolds a `.orm.yaml` **model**,
while the CLI's `project` command manages `.orm-project.yaml`
**multi-domain projects** (`init` and `split`; `domains/` and
`mappings/` are the directories they create). Different capabilities,
similar names; the `project` rows are correct.

`llm-usage` reports over the JSONL call log under the operator's own
state directory (`docs/specs/llm-call-observability.spec.md`). It stays
CLI-only for a reason the other dev-tooling rows do not share: the log
is written by whichever process made the calls, so a report from the
MCP server or the editor would summarise that surface's own log and
quietly answer a different question than the operator asked.

The `merge` and `review` rows were closed by
`docs/specs/cli-surface-parity.spec.md`. Two audit findings remain open
and are not surface-parity questions: `buildCodeExtractionPrompt` has
no call site (barwise-811) and few-shot demo rendering has never run on
real content (barwise-812).

## Monorepo Commands

`npm run <script>` works from the repo root **and** from `barwise/`.
The real package.json is `barwise/package.json`; the root one is
generated and does nothing but forward
(`npm --prefix barwise run <script> --`). It used to not exist, and
`npm run build` at the root failed with a bare ENOENT -- five broken
commands in one session, and one wrong claim, because the habit that
teaches is "run it from wherever and see". Generated by
`scripts/regen-root-package.mjs` and checked by
`npm run check:root-scripts`, which fails both on a script with no forwarder and on a forwarder for a script that no longer
exists. Anything else -- `npx`, `node scripts/...`, a relative path --
still means what it says relative to your cwd, so prefer absolute paths
there.

From anywhere inside the repository, a package directory included,
`node "$(git rev-parse --show-toplevel)/barwise/scripts/at-root.mjs" <script> [args]`
runs the same npm script with no `cd` in the command.
It exists because `cd barwise` fails when the working directory is
already `barwise/`, and this harness moves the working directory
between commands: twice in one session a satisfied `cd` failed, and
the second time it headed an `&&` chain, so `npm run fmt` was skipped
silently and the gate run went red (barwise-907, second occurrence).
A `cd` in a command is the habit that fails; spell the location once,
in the path. `scripts/tests/at-root.test.mjs` proves the wrapper gives
the same answer from the root, from `barwise/`, and from a package.

**Never wait for a long command by polling for its own process name.**
`until ! pgrep -f "ci:local"; do sleep 10; done` matches the wait loop's
own command line, which contains that string, so it waits on itself and
never exits -- twice now, the second time with the first occurrence
already written down, which is what makes "remember it" not a
countermeasure. Run the command itself in the background and read its
exit code, or poll a condition the waiter cannot satisfy (the log file's
last line, a sentinel the command writes on exit). The general shape is
the one the gates follow: an instrument that can report the state it was
asked about, rather than one that looks identical whether or not it can.

**A gate's status read through a pipe is the pipe's.** `npm run
test:scripts | tail -2; echo $?` printed 0 with a test failing, and
`mutate.mjs ... | tail -1` printed 0 while mutate had refused
(barwise-40a, after barwise-906 had already named the trap). So every
node process a Bash command starts directly records its exit code, and
a hook names the non-zero ones after each call: "These processes exited
non-zero, and the command still reported 0" means a status was hidden
or handled, and is the cue to re-read it
(`docs/specs/masked-exit-report.spec.md`). To change `NODE_OPTIONS` for
one command, append to it (`NODE_OPTIONS="$NODE_OPTIONS ..."`):
replacing it unloads the recorder for that process.

`npm run build`, `test`, and `lint` fan out via Turborepo in dependency
order; per-package runs use `npx vitest run` / `npx tsc --noEmit` from
the package directory.

**A per-package `tsc --noEmit` reads its dependencies' `dist`, not
their source.** After changing an exported type in `core` or `llm`, a
type-check in `cli` or `promptlab` passes against the _previous_ build
and reports clean on code that cannot compile -- then fails in CI or
the pre-commit hook with "Property X does not exist on type Y" naming
something you plainly just added. Run `npm run build` from `barwise/`
first whenever a change crossed a package boundary.

**Runtimes are pinned.** Node is the version in `.nvmrc`, which every
workflow reads -- v8 coverage thresholds are not portable across Node
versions. Python is pinned to the minor in `.python-version`. Verify the
interpreter that ran, never the file that asked
(`docs/adr/pinned-runtimes.md`).

**The hooks split by cost, not by preference.** Pre-commit is the fast
path: staged-file linting, a build, and the tests of packages a change
touches. Pre-push runs `npm run ci:local -- --commit <sha>` for each
pushed commit: the CI gate list derived from `ci.yml`, with ci.yml's `if:`
conditions applied through the same change classifier CI's detect step
runs (`scripts/lib/changed-class.mjs`), in a fresh worktree of that
commit with a fresh `npm ci`. Turbo's local cache is shared across
worktrees, so the build and `test:coverage` reuse what this checkout has
already computed. A working tree holds build
output and unpushed files a CI checkout lacks, and on PR #641 a script test
passed here because `dist` existed and failed in CI
(`docs/specs/pushed-tree-verification.spec.md`). A docs-only change skips
what CI skips, and `--all` runs everything. Plain `npm run ci:local`
checks the working tree, for use before a commit. `git push --no-verify`
is the escape hatch for work in progress. The hooks exist only after
`npm run prepare`, and do not run at all in a `git worktree` checkout
(barwise-mdp): there, run `npm run prepare` first, or run
`npm run check:secrets -- --staged` before committing and
`npm run ci:local -- --commit <sha>` before pushing.

## Versioning and Releases

The project uses a single version number across all packages, tracked
by git tags on main; a release is an intentional act, not automatic.
The bump/tag/release procedure and its gotchas live in the `release`
skill (`.claude/skills/release/`).

## Conventions (Monorepo-Wide)

- Create a spec before beginning development, and have its plan
  reviewed before implementing it (`docs/adr/plan-before-code.md`).
  The `spec-writer` skill has the house format, the design-principle
  framing and the pre-flight checklist; specs live in
  `barwise/docs/specs/`.
- Doc naming and dating (stable kebab names for specs, dated filenames
  for point-in-time artifacts) follows the convention in the
  `spec-writer` skill.
- Opening a PR follows the `pr-creation` skill, reviewing one follows
  `pr-review`, and merging one follows the `steward` skill's section 4b:
  the review has recommended `merge` on the head being merged
  (`docs/adr/merge-delegation.md`). Which review runs when is the root
  `REVIEW.md` (`docs/adr/review-policy.md`); the invariants CI cannot
  check live in `pr-review/checklist.md`.
- TypeScript strict mode. Base config in `barwise/tsconfig.base.json`
  uses NodeNext module resolution; the vscode package overrides to
  Bundler resolution for esbuild.
- Vitest for all test packages. Tests co-located under `tests/`
  mirroring `src/` structure.
- No emoji in output or documentation.
- No trivial dependencies: never add a package for something provided
  by JavaScript or Node core (e.g. use `node:crypto.randomUUID()` not
  `uuid`). High-quality libraries that solve real problems (yaml, ajv)
  are fine.
- **Every Python execution resolves from the project lockfile.** The
  form is `uv run --frozen [--only-group <g>] ...`, and `--locked` in
  CI. Never a bare `python3`, `python`, `pip` or `pip3` (the one
  exception is CI's pinned uv bootstrap); never `--with`,
  `--with-requirements`, `--isolated`, `--no-project`, `uv pip`, `uvx`,
  `uv tool run` or PEP 723 inline metadata. An optional tier (sqlglot)
  is a dependency-group in the single `pyproject.toml`. Keep
  `pyproject.toml` (at `barwise/`) an ancestor of anything that runs
  Python -- `uv run --frozen` with no project found exits 0 and resolves
  nothing -- and pass `--project` from outside `barwise/`. A one-off is
  a script in the repo run `--frozen`. `check:python-uv` and a
  `PreToolUse` hook enforce it (`docs/adr/python-from-the-lockfile.md`).
- A copy that must agree with other code carries a check in the commit
  that creates it: share it, derive it, register it in
  `barwise/parity.manifest.json`, or drift-test it -- a comment asking
  the editor to update the other copy is not a check. `npm run
  audit:duplication -- --check` ratchets candidates against
  `barwise/audit-baseline.json`; the `duplication-audit` skill has the
  rubric (`docs/adr/must-agree-copies.md`).
- A finding is closed by a mechanism, not a document: land a check that
  fails when it regresses, or a baseline row that must be removed when it
  is fixed, and wire the ratchet into CI. `audit:rubric`, `audit:specs`
  and `audit:corrections` are the other ratchets; the `assertion-audit`
  skill has the method (`docs/adr/findings-close-by-mechanism.md`).
- A baseline's verdicts are merged on write, never regenerated: the
  writers go through `scripts/lib/baseline-merge.mjs` (the trial gate's
  does not yet, barwise-tko), and
  `npm run audit:specs` writes only with `--write`
  (`docs/adr/baselines-merge-on-write.md`).
- **A gate that cannot see its input must not print PASS.** Exit 0
  pass, 1 a finding, 2 could not answer; a refusal never uses the
  finding code (`docs/adr/gate-refusal-contract.md`).
  `npm run fault-matrix` measures it, on demand.
- **A leaked credential is rotated, never reverted.** Detection is
  gitleaks' -- `npm run check:secrets -- --staged` at pre-commit, the
  full history in CI -- and `.gitleaks.toml` takes no rule beyond the
  one for Anthropic keys (`docs/adr/credential-handling.md`).
- **A key has nowhere to be written down.** `--api-key` is refused on
  every command and the VS Code key lives in secret storage; VS Code's
  default path needs no key, nor does the MCP server's where the client
  advertises sampling; the measurement lane is the one lane that holds
  one, workspace-scoped with a spend limit
  (`docs/adr/keyless-model-access.md`).
- ESLint config is shared at the repo root (`barwise/eslint.config.mjs`).
- Turborepo (`barwise/turbo.json`) orchestrates build/test/lint with
  correct dependency ordering.

## Beads Issue Tracker

Task tracking goes through **beads** rather than TodoWrite, TaskCreate,
or markdown TODO lists, so state survives across sessions and machines.

**The interface is `node barwise/scripts/beads-crud.mjs`, run from the
repo root -- the `bd` binary does not need to be installed.** The
scripts read and write `.beads/issues.jsonl` directly, so a container
without `bd` on PATH is fully equipped, not degraded; do not report a
missing `bd` as a blocker or install one to work around it. Subcommands
are `create`, `show`, `list`, `update`, `close`, `delete`
(`docs/specs/beads-issue-crud-scripts.spec.md`); `create` takes
`--title`, `--type`, `--priority`, `--status`, `--description`,
`--design`, `--acceptance-criteria`, `--notes`, `--labels`,
`--depends-on`, `--parent`, and the rest. `scripts/check-beads.sh`
validates the JSONL.

The core loop is unchanged in shape: `list` to find work, `show <id>`
to read it, `update <id>` to claim it, `close <id>` when it is done.

`create` mints a random three-character suffix (`barwise-k3x`), not the
highest number plus one. The counter read a tracker that is stale on
every branch behind main, and two open branches minted the same id at
least five times (barwise-w1u). Older numeric ids keep working.

A conflict on the tracker is resolved by a merge driver, not by hand:
`npm run prepare` installs `scripts/beads-merge-driver.mjs` into the
clone's git directory, and a local `git merge` then merges the file per
issue and per field, writing conflict markers only for what it cannot
decide (steward skill, section 1;
`docs/specs/beads-merge-driver.spec.md`). Before it, the
`.gitattributes` line named a driver nothing registered, git fell back
to a line merge without a word, and PR #704 resolved six conflicts by
hand in three days.

There is no `remember` subcommand -- persistent project knowledge goes
in this file, as a convention with the reason attached, not a
MEMORY.md.

## Session Completion

Work is not done until it is pushed. Sessions often run in ephemeral
containers, and anything left local is stranded when the container is
reclaimed -- so never end a session with unpushed work, and never hand
the push back to the user.

When ending a work session: file issues for any follow-up work, run
the quality gates if code changed (tests, linters, builds), update
issue status, then push and verify:

```bash
git pull --rebase
if command -v bd >/dev/null; then bd dolt push; fi  # issues.jsonl travels with git push either way
git push
git status  # must show "up to date with origin"
```

If a push fails, resolve the cause and retry until it succeeds. Then
clean up (clear stashes, prune remote branches) and hand off context
for the next session.
