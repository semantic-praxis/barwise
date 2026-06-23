# Repository Review -- 2026-06-23

Status: Off-cadence architecture assessment (architecture-analysis program),
prompted by a large cross-session delta -- 156 commits since the last
review, the Tier-1/2 metamodel constructs implemented, role-path landed, and
new project/tooling surfaces. Run against `HEAD` 7ffd096 (atop v1.6.1).
Scope: whole monorepo (10 packages), assessed against the design pillars via
the scenario catalog in `docs/architecture-scenarios.md`, the live fitness
functions, and a manual reflexion where `arch:triage` could not supply data
(see Methodology note).

This is the third review under the program and the successor to
`REPO_REVIEW-2026-06-16.md`. The headline since June: the metamodel grew
substantially and along the principled line ADR-0001 set, while the
structural pillars stayed mechanically enforced -- the new surface area did
not buy a back-edge, a determinism leak, or a connector-convention break.
The one moving smell is which _file_ absorbs that growth.

## Overall verdict

Discipline is holding under real expansion. `depcruise` (297 modules, 881
deps) reports the one-way graph intact; `check-core-purity` reports core
free of I/O, clocks, randomness, and the LLM SDKs. Twenty of the twenty-one
catalog scenarios pass; the lone _risk_ remains S-ORTH-5 (one concern per
module), and the god-file inventory has both _shrunk_ (16 files >600 lines
in June, 8 now -- most June offenders decomposed) and _shifted_: the new
top-of-list is the NORMA mapper, the LLM draft parser, and -- the one that
actively grew -- `OrmYamlSerializer.ts`, now the single sink every new
metamodel construct edits.

Two pillars are now exercised far harder than in June and came through
clean: explicit-over-implicit (the `1.0 -> 1.1` `orm_version` bump with a
registered forward migration and version-pinned schema) and determinism (a
much larger construct set, all serialized purely in core). The deferred
debt is the same shape as before -- known, bounded, now concentrated in one
or two files -- and the behavioral net (property round-trip, characterization
goldens, the NORMA RT-A round-trip) makes it safe to attack.

## Scenario walk

Each scenario from `docs/architecture-scenarios.md` (unchanged -- 21
entries, no additions since June), with status and how it is guarded.
"gated" = a CI fitness function; "tested" = a suite asserts it; "review" =
this assessment is the guard.

| Scenario                                    | Status | Guard today                          |
| ------------------------------------------- | ------ | ------------------------------------ |
| S-ORTH-1 core has no internal deps          | pass   | gated -- depcruise `layer-core`      |
| S-ORTH-2 connectors import only core        | pass   | gated -- depcruise `layer-*`         |
| S-ORTH-3 no connector-to-connector edge     | pass   | gated -- depcruise                   |
| S-ORTH-4 no import cycles                   | pass   | gated -- depcruise `no-circular`     |
| S-ORTH-5 one concern per module             | risk   | review -- 8 files >600 lines (F1)    |
| S-COMP-1 formats compose via registry       | pass   | depcruise + review (NORMA exporter)  |
| S-COMP-2 surfaces delegate, not reimplement | pass   | review -- holds (project surfaces)   |
| S-COMP-3 providers via factory              | pass   | review -- holds                      |
| S-COMP-4 narrow primitives over wide        | pass   | review -- roleGraph seam is exemplar |
| S-DET-1 no I/O in core                      | pass   | gated -- check-core-purity           |
| S-DET-2 no ambient randomness in core       | pass   | gated -- check-core-purity           |
| S-DET-3 no clock/env reads in core          | pass   | gated -- check-core-purity           |
| S-DET-4 repeatable output                   | pass   | tested -- property round-trip        |
| S-DET-5 non-determinism one layer out       | pass   | review -- file-object I/O in shells  |
| S-EXPL-1 schemaVersion stamped              | pass   | tested + serializer (now at 1.1)     |
| S-EXPL-2 unknown versions rejected          | pass   | tested -- migration + version pin    |
| S-EXPL-3 cross-domain via context mapping   | pass   | validation suite                     |
| S-EXPL-4 data products declare domains      | pass   | validation suite (OrmProject)        |
| S-EXPL-5 formats register by name           | pass   | review -- connector subfolders       |
| S-DRY-1 dup removed only w/o coupling       | pass   | review + warn-only jscpd (1.80%)     |
| S-DRY-2 no abstraction that bends an iface  | pass   | review -- import seam tolerated      |

## Findings

### F1. God files -- the inventory shrank but shifted (S-ORTH-5)

- [ ] Priority: P2 -- the one open _risk_ in the scenario walk

Eight source files exceed 600 lines (`npm run filesize`, warn-only), down
from sixteen in June. Most June offenders were decomposed; the open set has
shifted to the connector mappers, the LLM parser, and the core serializer:

| Lines | File                          | Pkg        | Note                          |
| ----: | ----------------------------- | ---------- | ----------------------------- |
|   966 | `norma/NormaToOrmMapper.ts`   | formats    | new #1; WS7 target (5t9.10)   |
|   960 | `DraftModelParser.ts`         | llm        | god-file spec WS6             |
|   935 | `OrmYamlSerializer.ts`        | core       | _grew_ 667 -> 935 (see below) |
|   704 | `norma/NormaXmlParser.ts`     | formats    | parser/inverse of the writer  |
|   691 | `mapping/RelationalMapper.ts` | core       | cohesive algorithm; watch     |
|   657 | `DbtToOrmMapper.ts`           | dbt        | god-file spec WS8             |
|   637 | `OrmDiagram.tsx`              | diagram-ui | god-file spec WS8             |
|   612 | `sql/SqlPatternExtractor.ts`  | core       | cohesive extractor; watch     |

The decompositions that landed are the positive control: `DiagramPanel.ts`
908 -> 422 (the presentation-contract dissolution), `ToolRegistration.ts`
661 -> 402, `ExtractionPrompt.ts` 617 -> 93, and `core/src/index.ts`
318 -> 167 (F2, below). The method works; F1 is now a shorter, re-prioritized
list.

### F2. Slim the core barrel -- largely resolved (S-COMP-1)

- [x] Priority: was P3, now mostly done

`core/src/index.ts` went 318 -> 167 lines: the capability modules are now
package subpath exports (`@barwise/core/mapping`, `/diff`, `/verbalization`,
`/query`, ...) per `core-subpath-exports.spec.md`, so consumers import what
they use and the barrel stopped being the cross-package coupling point the
June review flagged. The June #3 hotspot is retired. Residual: the root
still carries the foundational model/serialization/validation surface, which
is correct.

### F3. The growth sink is now the serializer, not the barrel (S-ORTH-5)

- [ ] Priority: P2 -- the cycle's clearest new smell

`OrmYamlSerializer.ts` is the one core file that materially _grew_ this
cycle: 667 -> 935 lines, now #3 on the >600 list. It absorbed the
read/write path for every Tier-1/2 construct (deontic modality, value
comparison, object cardinality, multi-role frequency, independent types,
defaults, notes, derivation) plus the role-path operands -- 42 construct
references and 18 role-path references in one file. This is exactly the
"every new symbol edits one file" pattern F2 diagnosed for the barrel, now
migrated to the serializer: it sits on the metamodel thread's hot path, so
each future construct (5t9.6 join constraints, the tuple revision, future
tiers) lands here. Recommend a decomposition spec that splits serialize and
deserialize by element/construct family -- the same move that took
`ConstraintVerbalizer` 768 -> 121 -- before the next construct batch. The
property round-trip suite makes it safe.

### F4. Cross-package coupling -- still healthy (S-DRY-2)

- [x] Priority: no action

`jscpd` is 1.80% (down from 1.93%), 36 clones, all _within-package_: the
LLM provider pair (`ollama.ts` <-> `openai.ts`), the vscode `Export*Command`
siblings, and `mcp review` <-> vscode `ToolRegistration`. No cross-package
duplication pulling toward a coupling abstraction -- the deliberate CLI/MCP
parallel code the June review endorsed under DRY-secondary. No action.

### F5. Carry-forward minors

- [ ] C3 -- ESLint + oxlint both run; still defensible, verify rule overlap
      is not pure double-reporting. P3.
- [ ] C5 -- `@vscode/chat-extension-utils` alpha pin -- expect churn. P3.
- [ ] C2 -- nested `barwise/barwise/` layout persists; disruptive, deferred.
      P3, likely "won't do".
- [ ] T2 -- MCP stdio JSON-RPC + LSP still tested in-process/mocked; a
      spawn-the-server smoke test would close it. P2, still open.

### F6. Issue-tracker continuity across sessions (process, not structure)

- [ ] Priority: P2 -- a program risk worth a decision

A concrete loss happened this cycle: bd issues filed by a session that
hand-edited `.beads/issues.jsonl` (no `bd` binary available) were dropped
when a `bd`-equipped session re-exported the tracker from its Dolt DB --
the hand-added rows were never ingested. Fifteen planning issues (a
consolidation epic, the role-path workstreams) vanished from main. The
durable record survived only because each traced to a committed spec. The
architecture-analysis program leans on bd for its "next candidates";
recommend a rule -- only a `bd`-equipped actor writes `issues.jsonl`, others
plan in specs and hand drafts to bd -- so the tracker stays authoritative.

## Methodology note (arch:triage gap)

`npm run arch:triage` ran clean but produced **no hotspot or
temporal-coupling data**: it windows on non-merge commits since the last tag
and `HEAD` is a tagged release (v1.6.1), so the window was empty ("Commits
analyzed: 0"). Its reflexion sub-checks (layer direction, purity) still ran
and report no divergences. The churn x size hotspot ranking that
distinguishes a _hot_ god file from a merely large one is therefore absent
this run; F1/F3 priorities above lean on size plus known change-locus rather
than measured churn. To recover the ranking, run the triage over
`v1.6.0..HEAD` (241 commits) rather than at the tag -- worth a small fix to
the triage script's default window so a review at a release tag is not
blind.

## What changed since 2026-06-16

156 commits (19 feat, 31 docs, 12 style). The substantive landings:

- **The Tier-1/2 metamodel batch is implemented, not just specced** -- deontic
  modality (5t9.3), value comparison (5t9.9), independent types (5t9.5),
  defaults (5t9.7), notes (5t9.12), object cardinality (5t9.4), derived fact
  types (5t9.2), multi-role frequency (5t9.8), all wired through the
  serializer under a single shared `orm_version` `1.0 -> 1.1` bump with a
  forward migration -- exactly the batched, additive discipline ADR-0001's
  schema-versioning section settled.
- **Role-path (5t9.10) landed** -- the shared `model/roleGraph.ts` traversal
  seam, the `RolePath`/`JoinOperand` types, the endpoint-model first cut and
  its population evaluation, and a 2026-06-21 revision to projected-tuple
  operands (now pending sign-off). Both new model files are small.
- **OrmProject support across all three surfaces** (CLI, MCP, VS Code) with
  the I/O kept in per-package `workspace/` shells -- determinism preserved.
- **source-as-file-object** on the MCP and VS Code tool surfaces.
- **`helpers/ -> workspace/` rename** in cli and mcp (naming the imperative
  shell).
- **`@barwise/formats` per-connector subfolders** plus the **NORMA XML
  exporter** with an RT-A round-trip guard -- the connector convention
  applied to the heaviest format.

## What is working well (keep doing it)

- The metamodel grew along ADR-0001's principled line, not a parity
  checklist, and the schema-versioning discipline (one shared minor bump per
  cycle, migration registered) makes the growth legible and reversible.
- Structural pillars stayed mechanically enforced through a 156-commit
  cycle: no back-edge, no determinism leak, no connector break -- the gates,
  not vigilance, held them.
- Decomposition specs keep retiring god files (`DiagramPanel`,
  `ToolRegistration`, `ExtractionPrompt`, the core barrel); the method is
  proven and repeatable.
- New I/O (project loaders, file-object sources) landed in tool-package
  shells, never in core.

## Next (candidates)

1. F3: a decomposition spec for `OrmYamlSerializer.ts` (split serialize /
   deserialize by construct family) before the next construct batch -- the
   cycle's highest-leverage refactor.
2. F1: continue the god-file specs in the new order -- `NormaToOrmMapper`
   (WS7, already coupled to the role-path/NORMA work), `DraftModelParser`
   (WS6).
3. Methodology: fix `arch:triage` to accept a base ref so a review at a
   release tag still gets hotspot data.
4. F6: settle the bd-write rule (only a bd-equipped actor writes the
   tracker) so the program's "next candidates" stay durable.
5. T2: the MCP stdio spawn-the-server smoke test (carried from June).

The fitness functions hold the line between releases; this review is the
judgment layer on top, refreshed off-cadence here because the cross-session
delta was large enough to warrant it.
