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
  cannot, they belong one layer out.

- **Explicit over implicit.** Cross-domain references go through
  declared context mappings; data products declare the domains they
  compose; every `.orm.yaml` carries a `schemaVersion`; import and
  export formats register through a named `FormatDescriptor` rather
  than being auto-discovered. When in doubt, require declaration
  instead of inference.

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
monorepo; its own header says what changed). The current structure
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
- `barwise/packages/formats/CLAUDE.md` -- standard interop connector package; registers the DDL/OpenAPI/Avro/NORMA/SQL descriptors into the `FormatDescriptor` registry
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
  |                                        NORMA/SQL descriptors
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

The one thing outside that graph is `barwise/optimizer/`: the DSPy
prompt-optimization lane. It is Python, it is dev-time only, and it
depends on the workspace **as a subprocess** (`barwise prompt schema`,
`barwise prompt score`) rather than by import. Turborepo does not know
it exists and CI does not run it. Nothing there may become a runtime
dependency -- if a capability built in that lane turns out to be needed
at run time, it moves into `@barwise/llm` as TypeScript. That is the
determinism rule applied one layer further out than `core`.

`@barwise/code-analysis` is the template for the connector convention:
a package outside `core` that keeps its own I/O (LSP sessions, repo
scanning) and registers importers into the `FormatDescriptor` registry,
rather than putting that I/O in `core`. `@barwise/dbt` follows the same
convention for the dbt importer/exporter (project-directory scanning and
the `dbt compile` subprocess), registering via `registerDbtFormats()`.
`@barwise/formats` carries the standard interop descriptors (DDL,
OpenAPI, Avro, NORMA, SQL) via `registerStandardFormats()`, so `core`
ships no interop format at all -- only the registry, the format
interfaces, and the native `.orm.yaml`.

Changes to `@barwise/core` can break all downstream packages. Run the
full monorepo build and tests after modifying core's public API.

## Current State

All development phases are complete; the full suite passes in CI
across all 12 packages. Core ships no interop format: the standard
descriptors live in `@barwise/formats`, dbt in `@barwise/dbt`, and
code importers in `@barwise/code-analysis`.

### Capability matrix across the three surfaces

The surfaces do **not** all expose the same capabilities. Consult this
before assuming one is reachable from the surface you are working on,
and update it in the same commit that changes a surface's reach.

**What "yes" means in the VS Code column**: the capability is reachable
from the editor, by either mechanism -- a `contributes.commands` palette
entry, or a language-model tool registered by `ToolRegistration.ts`.
Both count, and the column said so for `review` while counting the same
registration as "no" for seven others, which is how it came to assert
divergence that had not held for some time (barwise-988). Where a row's
VS Code answer rests on the tool registration rather than the palette,
it is qualified by `barwise.enableMcpServer`, which defaults on.

| Capability                                            | CLI | MCP | VS Code | Divergence                                                    |
| ----------------------------------------------------- | --- | --- | ------- | ------------------------------------------------------------- |
| validate, verbalize, diagram, export, import, analyze | yes | yes | yes     | none                                                          |
| `review`                                              | yes | yes | yes     | none (VS Code as a language-model tool)                       |
| schema, diff, query, describe, lineage, impact        | yes | yes | yes     | none (VS Code as language-model tools)                        |
| `merge`                                               | yes | yes | yes     | none (VS Code as a language-model tool)                       |
| `gym`                                                 | yes | yes | no      | deliberate: the editor has no exercise surface                |
| `project`, `history`                                  | yes | no  | no      | deliberate: repository operations                             |
| `prompt`                                              | yes | no  | no      | deliberate: dev tooling                                       |
| `llm-usage`                                           | yes | no  | no      | deliberate: reads a local operator log                        |
| prompt-artifact override (`--artifacts`)              | yes | no  | no      | deliberate: candidates are measured, not sent                 |
| multi-sample import (`--samples`)                     | yes | yes | no      | deliberate: an editor wants one quick pass                    |
| thinking-budget override (`--thinking-budget`)        | yes | no  | no      | deliberate: an experiment dimension, recorded per history row |

Every remaining gap is marked deliberate, which is the point: an
unmarked gap is a bug.

The `--artifacts` row hides a boundary the table's own axis cannot
show, because it falls _within_ the CLI rather than between surfaces:
`barwise prompt eval`, `prompt artifact` and `prompt run` accept a
directory of unshipped prompt candidates; `barwise import transcript`
and `barwise review` do not, and must not
(`docs/specs/artifact-resolution-parity.spec.md`). Production resolves
over `builtinArtifacts` alone, which is what makes the prompt any run
sent recoverable afterwards -- a pure function of barwise version,
surface, provider and model, which `barwise prompt artifact` computes
offline. Put the flag on a production command and an unreviewed prompt
can do real modelling work while the recorded `promptHash` resolves to
nothing. Trying a candidate against a live model is `barwise prompt
run`, which is what that lane is for. The tool lists behind the MCP and VS Code columns are now pinned --
`mcp/tests/serverSpawn.test.ts` and
`vscode/tests/unit/toolRegistration.test.ts` each assert their complete
sorted list with `toEqual`, so adding or removing a tool fails until
this table is updated in the same commit. The rest of the table is
still hand-maintained and is therefore still the kind of claim that
goes stale: it asserted parity that did not hold for two years'
worth of readers (`docs/unwired-capability-audit-2026-08-20.md`), and
then asserted divergence that did not hold either, because "deliberate"
reads as intent and nothing checked it (barwise-988). Treat a surface
change as incomplete until this table agrees with it.

One name collision worth stating, because it looks like a gap and is
not: VS Code's `barwise.newProject` scaffolds a `.orm.yaml` **model**,
while the CLI's `project` command manages `.orm-project.yaml`
**multi-domain projects** (`init`, `domains`, `mappings`, `split`).
Different capabilities, similar names; the `project` row is correct.

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
generated and does nothing but forward (`npm --prefix barwise run

<script> --`). It used to not exist, and `npm run build` at the root
failed with a bare ENOENT -- five broken commands in one session, and
one wrong claim, because the habit that teaches is "run it from
wherever and see". Generated by `scripts/regen-root-package.mjs` and
checked by `npm run check:root-scripts`, which fails both on a script
with no forwarder and on a forwarder for a script that no longer
exists. Anything else -- `npx`, `node scripts/...`, a relative path --
still means what it says relative to your cwd, so prefer absolute paths
there.

From anywhere inside the repository, a package directory included,
`node "$(git rev-parse --show-toplevel)/barwise/scripts/at-root.mjs"
<script> [args]` runs the same npm script with no `cd` in the command.
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

**Node is pinned in `.nvmrc`, and both workflows read it.** Not a
preference: v8 coverage thresholds are not portable across Node versions.
V8 leaves functions it never compiled out of its coverage report, so a
module no test constructs is counted as one function on Node 22 and
nineteen on Node 26 -- `@barwise/code-analysis` read 95% functions on one
and 81% on the other from identical source. A floating runtime means the
gate passes or fails by whichever Node you happen to have.

**Python is pinned in `.python-version`, beside `.nvmrc`, and only to the
minor.** `uv.lock` branched on `python_full_version < '3.12'`, so `uv sync
--frozen` honoured the lock and still installed numpy 2.4.6 locally against
2.5.2 in CI, from one commit -- the interpreter selects which half of the
lock applies, and nothing pinned it. The lock now carries a single
resolution. The pin stops at the minor because an exact patch is not
enforced: with `.python-version` reading `3.13.12`, `uv sync` prints "Using
CPython 3.13.7" and exits 0. Verify the interpreter that ran, never the
file that asked.

**The hooks split by cost, not by preference.** Pre-commit is the fast
path: staged-file linting, a build, and the tests of packages a change
touches. Pre-push runs `npm run ci:local`, which is the whole CI gate
list derived from `ci.yml` -- about 30s warm and 2m40s once a source
file changed, of which `test:coverage` alone is 109s. That belongs at
the push because a push is what makes CI run, and because the same list
per commit is a hook people turn off. `git push --no-verify` is the
escape hatch for work in progress; a red push is the thing it is worth
30 seconds to avoid.

## Versioning and Releases

The project uses a single version number across all packages, tracked
by git tags on main; a release is an intentional act, not automatic.
The bump/tag/release procedure and its gotchas live in the `release`
skill (`.claude/skills/release/`).

## Conventions (Monorepo-Wide)

- ALWAYS create a spec file before beginning development. There should
  be a documented and reviewed plan to ensure the quality of work is
  high. Use the `spec-writer` skill for the house spec format, the
  design-principle framing, and the pre-flight checklist; specs live
  in `barwise/docs/specs/`.
- Doc naming and dating (stable kebab names for specs, dated filenames
  for point-in-time artifacts) follows the convention in the
  `spec-writer` skill.
- Opening a PR follows the `pr-creation` skill and reviewing one
  follows `pr-review`; the barwise invariants CI cannot check live once,
  in `pr-review/checklist.md`, which the author runs before a reviewer
  has to (`docs/specs/pr-skills.spec.md`).
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
  CI so a stale lock fails the build instead of being re-resolved
  silently. Never a bare `python3`, `python` or `pip`. Never `--with`,
  `--with-requirements`, `--isolated`, or `uv pip`. An optional tier
  (sqlglot) is a dependency-group in the single `pyproject.toml`, so it
  lives in the lock and `--only-group` installs it alone.

  **The flag only means anything when a project is discovered.**
  `uv run --frozen` does not fail where there is no `pyproject.toml` to
  find -- it silently runs a uv-managed interpreter with no lock and no
  dependencies, and exits 0. That is why the project sits at `barwise/`
  rather than in `barwise/optimizer/`: `uv run` discovers a project by
  walking UP from the cwd, so from `barwise/packages/formats` the old
  location was a sibling and invisible, and every `--frozen` call there
  would have read as compliant while resolving nothing. Keep
  `pyproject.toml` an ancestor of anything that runs Python, and never
  take a green `uv run --frozen` as evidence the lock was used.

  Pinning the interpreter is not enough, and neither is `uv run` by
  itself. Against a lock pinning `sqlglot==27.28.0`, `uv run --with
  sqlglot==27.20.0` runs 27.20.0 -- and so do the `--frozen` and
  `--locked` spellings of it, while `uv lock --check` still reports
  clean. An older library, silently, undetected: `--with` is a lock
  bypass the assertion flags do not close, which is why it is banned
  outright rather than paired with something. The interpreter half of
  this is the `.python-version` pin above; this is the dependency half,
  and the failure is the same one (numpy 2.4.6 against 2.5.2 from one
  commit) one layer down.

  A one-off is still a run of this project: put the script in the repo
  and run it `--frozen`. Not `--with`, and not PEP 723 inline script
  metadata, which pins versions in the script where the lock does not
  govern them. Every required and banned form above is literal text in
  a command, which is what makes this checkable where "activate the
  venv first" is not (barwise-921). The one standing exception is
  bootstrapping uv itself.
- A copy that must agree with other code is never guarded by a
  comment: share it, derive it from the authority, register the pair
  in `barwise/parity.manifest.json` (checked by `npm run
  check:parity`), or give it a drift test -- in the same commit that
  creates the copy. `npm run audit:duplication -- --check` ratchets
  new candidates against `barwise/audit-baseline.json`; the
  `duplication-audit` skill carries the rubric and the full-sweep
  method. Deliberately parallel code stays (DRY is secondary);
  unchecked must-agree code does not
  (`docs/specs/duplication-drift-guards.spec.md`).
- A finding is not closed by a document. The same rule the
  must-agree copies follow -- share it, derive it, register it, or
  drift-test it, in the same commit -- applies to anything an audit
  turns up: land a check that fails when it regresses, or a baseline
  row that has to be removed when it is fixed. `npm run audit:rubric
  -- --check` ratchets the eval rubric's discriminating checks against
  `barwise/rubric-baseline.json` the way `audit:duplication` ratchets
  the copies; both fail on a new unclassified finding AND on a stale
  entry, so the baselines always enumerate exactly what is open.
  `npm run audit:specs -- --check` is the third: a spec whose `Status`
  claims no implementation must not be sitting on top of commits that
  touched the source it names (barwise-910). A
  sweep run by hand runs once, and the next edit reintroduces what it
  found. The `assertion-audit` skill carries the three mutation passes
  and the method rules.
- **A gate that cannot see its input must not print PASS.** Pass, fail,
  and **could not answer** -- exit `2` for the third, which is what
  `mutate.mjs` and `audit-gate.mjs` already used and what every gate now
  uses. It exists because `PASS` otherwise means both "the thing is
  fine" and "I could not see the thing", and the reader cannot tell
  which: `audit-gate` reported PASS with zero advisories from a package
  directory, and `check-shell` reported an absent shellcheck with the
  same exit code it uses for a real bug in a script
  (`docs/specs/gate-refusal-contract.spec.md`). `npm run fault-matrix`
  is the instrument: it runs every node gate ci.yml names under four
  environment faults -- `git` answering emptily, `git` absent, a shallow
  clone, three working directories -- and reports which refuse, which
  are independent of the fault, and which answer anyway. Whether a gate
  DEPENDS on the broken thing is measured (the `git` shim logs every
  call), not declared, so no list has to be kept in step. On demand,
  like `mutate`; not in CI.
- **A leaked credential is rotated, never reverted.** It is the one gate
  whose failure a later commit cannot undo: reverting, deleting the branch
  and rewriting history all leave the key valid and already disclosed.
  `.gitignore` covering `.env` was what stood in for it, and could not see
  the three paths a secret actually arrives by here -- machine-written
  tracked files under `eval-payloads/` and `eval-runs/`, commands pasted
  into documentation, and fixtures imitating real payloads
  (`docs/specs/credential-scanning.spec.md`).

  **Detection is gitleaks', not ours.** `npm run check:secrets -- --staged`
  runs at the pre-commit hook (the index, depth-independent, ~0.15s) and
  `npm run check:secrets` scans all reachable commits in CI. The first
  version of this gate hand-wrote ten vendor regexes; they flagged AWS's
  own documented example key, which is a false positive that fails every
  commit quoting a manual. Do not add rules here -- `.gitleaks.toml` is
  `[extend] useDefault = true` plus exactly ONE rule, for Anthropic keys,
  which gitleaks 8.28.0 genuinely does not detect (measured: 0 of 3
  realistic shapes, including a plain `ANTHROPIC_API_KEY=` assignment).
  That is the credential this repo is most likely to leak, and
  barwise-1028 tracks sending the rule upstream so we stop carrying it.

  The wrapper exists for the gate contract, not for detection: exit `2`
  when gitleaks is absent, when `.gitleaks.toml` is absent (its defaults
  would silently drop the Anthropic rule), when a history scan is asked of
  a shallow clone, or when gitleaks exits anything but 0 or 1. It always
  passes `--redact`, because CI logs are retained and searchable so an
  echoing gate becomes a second durable copy of the leak, and `--verbose`,
  because without it the output is "leaks found: 1" with no rule, file or
  line. The version is pinned with a verified digest in
  `scripts/install-gitleaks.sh` -- one home, shared by `ci.yml` and the
  session hook, because gitleaks ships RULES and two versions would apply
  different rule sets to the same diff. A fresh session clone is shallow;
  the hook unshallows it so the history scan can answer. Taken once over
  1056 commits: 0 findings (barwise-1022).
- **A key has nowhere to be written down.** Detection is the weaker half, so
  the places a credential could sit are gone
  (`docs/specs/keyless-model-access.spec.md`). `--api-key` is refused on
  every CLI command -- argv reaches shell history, CI logs and
  `/proc/<pid>/cmdline` -- and that refusal lives once on the root program,
  so a newly added command cannot reintroduce it. In VS Code the key is in
  `ExtensionContext.secrets`, not a setting `.vscode/settings.json` could
  carry into a commit. The editor's default path needs no key at all
  (`CopilotLlmClient` over `vscode.lm`), and the MCP server's does not either
  where the client advertises sampling. The one lane that must hold a key is
  promptlab and the optimizer: a host-mediated call has no attributable
  model, so a score computed through one measures nothing. Give that lane a
  workspace-scoped key with a spend limit, never a personal one.
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
bd dolt push
git push
git status  # must show "up to date with origin"
```

If a push fails, resolve the cause and retry until it succeeds. Then
clean up (clear stashes, prune remote branches) and hand off context
for the next session.
