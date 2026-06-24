# God-file decomposition

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-17
Last-updated: 2026-06-24
Tracking: REPO_REVIEW-2026-06-16 finding F1 (S-ORTH-5); REPO_REVIEW
2026-06 A1.

## Principle

S-ORTH-5 ("one concern per module") is the lone _risk_ in the scenario
walk, and the `filesize` warn lists thirteen source files over 600
lines. Size is a smell, not a rule -- a cohesive algorithm can be
legitimately long -- so the goal is not "every file under 600" but
"split the files whose length signals _more than one concern_, where a
clean seam exists." The behavioral net landed since June (property
round-trip in `core/tests/property/`, characterization goldens in
`cli/tests/characterization/`) makes these refactors safe: parity is the
acceptance test, asserted by the existing suites.

This is the program the review's F1 anticipated -- the same method that
took `ElkLayoutEngine` from 1,812 to 147 lines, `cli/import.ts` to 43,
and `DiagramPanel` to 422, applied to the next offenders, each its own
shippable PR.

## Scope

In scope: decompose the files with a clear seam (the eight marked
"decompose" below), each as its own workstream. Each keeps the public
API and behavior identical; the suite is the guard.

Out of scope: the files marked "keep" -- genuinely cohesive parsers and
algorithms (`NormaXmlParser`, `RelationalMapper`, `OrmYamlSerializer`,
`SqlPatternExtractor`) whose length reflects one concern, not many.
Splitting them would scatter a single algorithm across files for a
line-count number, trading cohesion for a metric. They stay on the
`filesize` watch list as an acknowledged, accepted smell.

## Inventory

| File                           | Lines | Shape                               | Verdict                               |
| ------------------------------ | ----- | ----------------------------------- | ------------------------------------- |
| vscode `ToolRegistration.ts`   | 661   | 14 near-identical tool classes      | decompose: metadata table + factory   |
| llm `DraftModelParser.ts`      | 957   | 4-pass algorithm, 7 fns             | decompose: one module per pass        |
| llm `ExtractionPrompt.ts`      | 616   | prompt + constraint-inference rules | decompose: extract rules data module  |
| core `ConstraintVerbalizer.ts` | 768   | 1 class, 21 per-constraint methods  | decompose: split by constraint family |
| core `ModelDiff.ts`            | 712   | 9 exports, per-element diff fns     | decompose: per-element-kind modules   |
| core `describeDomain.ts`       | 648   | 7 exports, per-summary fns          | decompose: per-summary-kind modules   |
| formats `NormaToOrmMapper.ts`  | 948   | 1 class, ~30 mapping methods        | decompose: split mapping by concern   |
| dbt `DbtToOrmMapper.ts`        | 657   | 1 mapper class                      | provisional: split like Norma         |
| diagram-ui `OrmDiagram.tsx`    | 637   | React diagram component             | provisional: extract subcomponents    |
| formats `NormaXmlParser.ts`    | 669   | cohesive XML parser                 | keep (cohesive); watch                |
| core `RelationalMapper.ts`     | 689   | cohesive Rmap algorithm             | keep (cohesive); watch                |
| core `OrmYamlSerializer.ts`    | 666   | serialize + deserialize             | keep (cohesive pair); watch           |
| core `SqlPatternExtractor.ts`  | 611   | cohesive SQL extractor              | keep (cohesive); watch                |

## Target shape

Each decomposition keeps the existing public entry point as a thin
orchestrator/barrel and moves the per-concern logic into sibling
modules in a new subfolder, mirroring how `ElkLayoutEngine` was split:

```
src/<area>/
  <Entry>.ts          # thin: public class/function, delegates
  <entry>/            # new: one module per concern
    pass1Foo.ts
    pass2Bar.ts
    ...
```

Public exports (and the `@barwise/core/<subpath>` surface) are unchanged
-- only the internal file layout moves.

## Workstreams (each its own PR, smallest blast radius first)

### 1. `ToolRegistration.ts` -> metadata table + factory (grounded)

The 14 tool classes are near-identical: `invoke` resolves the source
param, calls the matching `execute*` from `@barwise/mcp`, and wraps the
result with `toToolResult`; `prepareInvocation` returns a static
`invocationMessage`. Replace them with a metadata table (tool name ->
`{ run(input): McpResult, message }`) and one generic
`LanguageModelTool` adapter built from each row. The two genuine
outliers -- `import_transcript` (uses `CopilotLlmClient`) and
`review_model` -- keep bespoke `run` closures in the table. The
registration loop iterates the table. Lowest risk (vscode-only,
self-contained, no core change), highest clarity win; first.

### 2. `ExtractionPrompt.ts` -> extract the rules (provisional)

Move the constraint-inference rule text/data out of the prompt builder
into a sibling data module; the builder composes them. Small, llm-only.

### 3. `ModelDiff.ts` -> per-element-kind modules (provisional)

Nine exports already; split the object-type / fact-type / definition
delta functions into sibling modules under `diff/`, with `ModelDiff.ts`
re-exporting. The property round-trip and diff suite guard it.

### 4. `describeDomain.ts` -> per-summary modules (provisional)

Seven exports; one module per summary kind (entity, fact-type,
constraint, population), `describeDomain` orchestrates.

### 5. `ConstraintVerbalizer.ts` -> per-family modules (provisional)

Split the 21 per-constraint methods by constraint family (uniqueness,
mandatory, set-comparison, ring, frequency), the class delegating.

### 6. `DraftModelParser.ts` -> one module per response pass (grounded 2026-06-23)

`parseDraftModel` is one ~700-line function that builds an `OrmModel` from
the LLM `ExtractionResponse` in sequential passes over each response section
-- object types, fact types, inferred constraints (the ~375-line bulk),
subtypes, populations, objectifications -- followed by a helpers block. The
only threaded state is `(model, warnings)`; each pass mutates the model,
accumulates warnings, and owns its provenance array.

Decompose into a `parse/` subdir (the shape the `prompt/` split already set in
this package), one module per pass -- `objectTypes`, `factTypes`,
`constraints` (with the constraint-only `isDuplicateConstraint`/`arraysEqual`),
`subtypes`, `populations`, `objectifications` -- plus `parse/helpers.ts`
(`resolveRolesByPlayerName`, `camelCase`, `buildDefaultReading`,
`resolveDataType`, the `VALID_*` sets). Each pass is a function
`parseX(section, model, warnings): XProvenance[]` that returns its provenance;
`DraftModelParser.ts` keeps `parseDraftModel` as the orchestrator -- set up
`model`+`warnings`, call the passes in order (order matters: constraints
resolve roles against fact types built earlier), assemble the
`DraftModelResult`. No behavior change; guarded by the llm parser suites
(`DraftModelParser`, `ExtractionConformance`, `ReasoningTrail`, `Alternatives`,
`TranscriptProcessor`, `Pipeline.integration`). Off the metamodel conflict
surface, so no cross-thread coordination.

### 7. `NormaToOrmMapper.ts` -> split mapping by concern (provisional)

~30 methods on one class; group by mapped concern (object types, fact
types, constraints, data types) into helper modules the mapper composes.
`DbtToOrmMapper.ts` (WS8) follows the same shape if it proves out here.

### 8. `DbtToOrmMapper.ts` (grounded 2026-06-24) / `OrmDiagram.tsx` (provisional)

`DbtToOrmMapper` is a stateful `DbtMapper` class whose `map()` runs
`indexSourceDataTypes -> analyzeModels -> phase1CreateEntityTypes ->
phase2CreateValueTypes -> phase3CreateFactTypes`, sharing six `Map`s
(pk / rel / entityId / valueTypeId / source-data-type indices) plus `doc`,
`model`, and a `report` builder across the phases via `this`. Below the
class sit free helpers (`buildConstraints`, `hasTest`,
`findRelationshipTest`, `resolveDataType`, `toPascalCase`,
`inferModelDescription`, `inferColumnDescription`).

Split by concern into a `dbtMapping/` subdir, threading the shared state as
an explicit mutable `DbtMapperContext` (the six maps + `doc` + `model` +
`report`) rather than instance fields:

```
context.ts      DbtMapperContext + PkInfo / RelationshipInfo types
sourceTypes.ts  indexSourceDataTypes + resolveSourceColumnType
analyze.ts      analyzeModels (PK/FK/test detection)
entityTypes.ts  phase 1     valueTypes.ts  phase 2     factTypes.ts  phase 3
constraints.ts  buildConstraints, hasTest, findRelationshipTest
naming.ts       resolveDataType, toPascalCase, infer* descriptions
```

Each phase is `phaseX(ctx): void` mutating the shared context; the helpers
stay pure. `DbtToOrmMapper.ts` keeps `mapDbtToOrm` as the orchestrator
(build the context, run the phases in order -- analysis populates the maps
the create-phases read -- return `{ model, report }`) plus `DbtMappingError`
and `DbtMapResult`. No behavior change; guarded by the dbt import suites
(`DbtProjectImporter`, `DbtImportFormat`, `DbtSchemaParser`, `registration`).

`OrmDiagram.tsx` stays provisional (extract React subcomponents); a separate
follow-on, off the critical path.

## API and migration impact

- No public API change in any workstream: each entry point keeps its
  exported class/function and signature; only internal files move.
- `depcruise` and `purity` are unaffected (intra-package moves, no new
  cross-package edges, no I/O into core). `knip` must not flag the new
  sibling modules -- they are imported by the entry point, so they are
  reachable; verify per PR.
- The `filesize` warn list shrinks by one per landed workstream; the
  four "keep" files remain listed and that is expected.

## Open decisions (for review)

- **Which "keep" files to leave.** Recommend leaving the four cohesive
  ones (`NormaXmlParser`, `RelationalMapper`, `OrmYamlSerializer`,
  `SqlPatternExtractor`); the reviewer may want one of them split anyway.
- **Stop point.** The eight decompositions are independent; the program
  can stop after any. WS1-6 are the clear wins; WS7-8 are larger and
  lower-priority.

## Risks and testing

- Behavioral parity is the bar, not improvement. Each PR runs the full
  build + test + `depcruise` + `purity` + `knip`; the property
  round-trip (core), characterization goldens (cli), and the diagram /
  vscode suites are the regression net.
- A decomposition that needs new test coverage (e.g. a pure unit now
  separately testable) adds it in the same PR, as the ElkLayoutEngine
  split did.
- Land smallest-first so the method is validated on a low-risk file
  (WS1) before the large core/llm files.

## Non-goals

- No behavior, output, or public-API change. No new capabilities.
- No forced line-count target; the four cohesive files stay as they are.
