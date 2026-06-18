# Refactor / metamodel-evolution consolidation

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-18
Last-updated: 2026-06-18
Tracking: barwise-jtl (consolidation epic),
REPO_REVIEW-2026-06-16.md (F1 god files, F2 core barrel, F4 minors),
docs/adr/0001-metamodel-evolution-policy.md, barwise-5t9 (+ children),
docs/specs/god-file-decomposition.spec.md,
docs/specs/diagram-presentation-contract.spec.md,
docs/specs/norma-export.spec.md

## Principle

Two threads edit the codebase concurrently -- an architecture/refactor
thread (this one, working the REPO_REVIEW god-file and barrel findings)
and a metamodel-evolution thread (adding ORM 2 constructs from the
barwise-5t9 menu under ADR-0001). Orthogonality and composability are the
primary pillars, but they govern the _code's_ structure; this spec
applies the same discipline to the _work_, so the two threads do not
double-edit the same files and force each other into repeated rebases.

The resolving observation is that the two backlogs barely intersect. The
metamodel thread threads each new construct through a fixed conflict
surface in `core` and the NORMA importer; the refactor backlog is mostly
_downstream_ of that surface (vscode, llm, diagram, dbt) or on `core`
files the metamodel thread never touches (diff, describe). Where they do
meet -- exactly two files -- the cheaper total ordering is to let the
thread with the more numerous imminent edits hold the file, and have the
other yield until a named quiescence window. This spec records that split
so neither thread decides it unilaterally.

## Should the threads serialize or run in parallel? (resolved: parallel)

They run in parallel. Serializing the whole architecture backlog behind
the Tier-1 metamodel batch would idle the top hotspot (`DiagramPanel`, 23
commits) for no reason -- it shares no file with the metamodel queue. The
honest unit of contention is not "the two threads" but "two specific
files": `core/src/index.ts` (every construct adds a public export) and
the NORMA importer `formats/src/Norma*.ts` (every construct adds a
mapping). Everything else is disjoint and proceeds now.

For those two files the choice is _extend-then-decompose_, not the
reverse. Tier-1 has five constructs left (5t9.9, .5, .7, .12, .3), each a
small additive edit to both files. A structural refactor that moves them
wholesale would collide with all five in-flight PRs and force the
metamodel thread to rebase repeatedly. Letting Tier-1 land first costs the
refactor thread one rebase of its own, against a settled shape -- the
strictly cheaper ordering. The already-merged `ConstraintVerbalizer` split
(below) shows the synergy: a decomposed file makes the metamodel thread's
job _easier_ (add a module, not a switch-case), so decompose-first wins
wherever the refactor has already landed.

## Scope

In scope: a sequencing and ownership agreement between the two threads --
which refactors run now, which wait, who holds the contended files, and
the invariants every refactor must preserve. The bd issues that track each
lane.

Out of scope: the refactors themselves. Each god-file decomposition keeps
its own spec (`god-file-decomposition.spec.md`,
`diagram-presentation-contract.spec.md`) and ships as its own PR; this
spec only orders them against the metamodel queue. The metamodel
constructs are out of scope entirely -- they are the other thread's, under
ADR-0001.

## Inventory

The architecture backlog crossed against the metamodel thread's declared
conflict surface. "Contention" is whether a refactor and an in-flight
metamodel edit touch the same file.

| Refactor item                        | Package / file                        | Conflict-surface? | Lane |
| ------------------------------------ | ------------------------------------- | ----------------- | ---- |
| `DiagramPanel` -> `DiagramSession`   | vscode + diagram                      | no                | A    |
| WS2 `ExtractionPrompt`               | llm                                   | no                | A    |
| WS3 `ModelDiff`                      | `core/src/diff/`                      | no                | A    |
| WS4 `describeDomain`                 | `core/src/describe/`                  | no                | A    |
| WS6 `DraftModelParser`               | llm                                   | no                | A    |
| WS8 dbt mapper / `OrmDiagram.tsx`    | dbt + diagram-ui                      | no                | A    |
| T2 MCP stdio smoke test              | mcp (test only)                       | no                | A    |
| F2 core subpath exports              | `core/src/index.ts`                   | _yes_             | B    |
| WS7 `NormaToOrmMapper` decomposition | `formats/src/Norma*.ts` (importer)    | _yes_             | B    |
| NORMA exporter (WS1 of export spec)  | `formats/src/registration.ts` (+ new) | _registry edit_   | B*   |
| WS5 `ConstraintVerbalizer` (merged)  | `core/src/verbalization/constraints/` | was -- now done   | C    |

Not on the refactor backlog, so no contention from this thread:
`OrmYamlSerializer.ts` (god-file spec verdict is _keep -- cohesive pair_,
not decompose), `Constraint.ts` / `ObjectType.ts`, `validation/rules/**`
(populationValidation already decomposed), and `orm-model.schema.json`.
Those are the metamodel thread's lane, uncontested.

## Target architecture

```
Lane A -- run now, parallel, zero coordination (disjoint from core
          metamodel surface):
  DiagramPanel -> DiagramSession  (top hotspot; do first)
  WS2 ExtractionPrompt   WS3 ModelDiff   WS4 describeDomain
  WS6 DraftModelParser   WS8 dbt/OrmDiagram   T2 MCP smoke

Lane B -- the two contended files; extend-then-decompose:
  metamodel thread HOLDS  core/src/index.ts  +  formats/src/Norma* importer
  through the Tier-1 batch (5t9.9, .5, .7, .12, .3).
  Quiescence window opens when Tier-1 lands ->
    refactor thread takes F2 (subpath exports) and WS7 (importer split),
    rebasing once onto the settled shape.
  B* NORMA exporter WS1: pure new modules + one registry line; ownership
     is an Open decision (registry touch is architecturally significant).

Lane C -- already decomposed; notify, do not block:
  ConstraintVerbalizer is now per-family modules under
  verbalization/constraints/. Metamodel thread adds a module + an
  exhaustive-switch case for 5t9.9, not an edit to a god switch.
```

## Workstreams (each independently shippable)

### 1. Publish the agreement and open the Lane A work

This spec, plus bd issues for every lane item linked to `barwise-5t9` and
ADR-0001, so both threads read one tracker. Lane A issues are marked ready
immediately; the `DiagramPanel` -> `DiagramSession` refactor
(`diagram-presentation-contract.spec.md`) starts first as the top hotspot.
No core file touched, so it cannot collide with the metamodel queue.

### 2. Lane C handoff note (provisional: not yet grounded)

A short note to the metamodel thread (issue comment on 5t9.9 and a line in
this spec's tracker) that `ConstraintVerbalizer` is decomposed: a new
constraint's verbalization is a module under `verbalization/constraints/`
plus a case in the family dispatch, and the dispatch keeps an exhaustive
`never`-typed default so an unhandled member is a compile error. This is
documentation, not code; it removes the file from contention.

### 3. F2 subpath exports + WS7 importer split (provisional: not yet grounded)

After the Tier-1 batch lands, the refactor thread takes `core/src/index.ts`
(F2 subpath exports) and `NormaToOrmMapper` (WS7), each its own spec and
PR, rebased once onto the settled file. F2's export boundaries are drawn
to anticipate a future `@barwise/core/query` / role-path module (5t9.10,
Tier 3) so the cut does not have to be redone when that fork lands -- see
Open decisions. WS7 splits the importer by mapping concern without
changing what it imports, so the NORMA import suite stays green unchanged.

### 4. NORMA exporter WS1 (provisional: ownership pending -- see Open decisions)

The semantic NORMA exporter from `norma-export.spec.md` WS1: new pure
modules (`NormaXmlWriter`, `NormaXmlSerializer`, `NormaExportFormat`) plus
one line adding `exporter:` to the `normaFormat` descriptor in
`registration.ts`. It has no metamodel dependency (it serializes the
representable subset; RT-B fidelity grows later as 5t9 lands, co-located
with each construct's PR). The registry edit is the one architecturally
significant touch -- flagged below.

## API and migration impact

- No `@barwise/core` _behavior_ change from any refactor here; the
  decompositions move code within a layer and change no model fields, so
  the property round-trip and RT-A stay green.
- F2 (Lane B) is the only item that changes `core`'s public import
  surface: it adds subpath exports (`@barwise/core/format`, etc.). That is
  its own spec; downstream consumers migrate their imports there, not
  here.
- The NORMA exporter adds one public export from `@barwise/formats`
  (`NormaExportFormat`) and lights up `barwise export --format norma`
  through the existing registry -- no CLI/MCP code change.
- Blast radius is surfaced by the one-way build: a core refactor rebuilds
  every downstream package, which is the guard that nothing silently
  drifts.

## Open decisions (for review)

- **NORMA exporter WS1 ownership.** Recommend the refactor/architecture
  thread owns WS1 (pure modules outside core, follows the connector
  convention), and WS3 fidelity extensions are co-located with whichever
  5t9 PR makes each construct representable, per the export spec's own
  framing. The registry edit (`registration.ts` gains an `exporter`) is
  the architecturally significant touch and is the reason this is a joint
  call rather than a unilateral start.
- **F2 subpath-export boundaries vs the Tier-3 role-path fork.** Recommend
  drawing the F2 subpath boundaries to leave room for a future
  `@barwise/core/query` / role-path module, so the export cut survives
  when 5t9.10 (Tier 3) lands rather than being recut. This couples a
  refactor decision to a metamodel fork, so both threads should agree the
  boundary names before F2 starts.
- **Spec vs ADR for this agreement (resolved: spec).** ADR-0001 already
  holds the standing metamodel-evolution _policy_; this is a point-in-time
  _sequencing plan_ that changes as lanes drain, so it is a living spec
  with `Last-updated`, not a new ADR.

## Risks and testing

- The contended files are the whole risk. The mitigation is the held-file
  rule: while a file is held, the non-holding thread opens no PR that
  edits it. CI catches an accidental cross-edit as a merge conflict, not a
  silent logic clash, because the refactors change structure and the
  metamodel edits add fields -- disjoint hunks that only collide on
  position.
- Every refactor here preserves the ADR-0001 invariants and is guarded
  accordingly: determinism in core (`check-core-purity`), the
  discriminated-union + exhaustive type-guard dispatch (a `never` default
  keeps an unhandled new member a compile error), lossless round-trip
  (property round-trip + RT-A, unchanged because no field changes), and
  JSON Schema left untouched (no `orm-model.schema.json` edit from this
  thread).
- Land each lane item as its own PR keeping the full suite green; run
  `npm run build`, `npm run test`, `npm run lint`, `npm run depcruise`,
  and `npm run purity` after any core-touching step.

## Non-goals

- No metamodel capability is added or changed here; the barwise-5t9
  constructs are the other thread's, under ADR-0001.
- No refactor is _specified_ here -- each keeps its own spec. This
  document only orders them.
- No change to the FormatDescriptor registry beyond the single
  `exporter:` line the NORMA exporter adds, and only once its ownership
  Open decision is resolved.
- No back-edge in the dependency graph: `DiagramSession` moves logic into
  `@barwise/diagram` (already a vscode dependency), preserving the one-way
  graph.
