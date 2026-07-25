# barwise-obe: Deterministic conformance validation for LLM extraction

Status: Implemented -- enforceConformance
(packages/llm/src/ExtractionConformance.ts) runs between
parseExtractionResponse and parseDraftModel in TranscriptProcessor.
Created: 2026-03-08
Last-updated: 2026-07-25

## Problem

The LLM extraction pipeline produces structurally invalid output that
the `DraftModelParser` must handle gracefully. For example, the LLM
emits population entries for enumerated value constraints with empty
`instances` arrays, causing "Cannot convert undefined or null to
object" parser warnings. The ~550-line extraction prompt already
carries significant cognitive load; adding more "don't do X" rules is
fragile and degrades extraction quality elsewhere.

## Solution

Add a deterministic conformance validation step between
`parseExtractionResponse()` and `parseDraftModel()` in
`TranscriptProcessor.ts`. This function takes an `ExtractionResponse`,
applies structural checks against ORM 2 invariants, and returns a
cleaned `ExtractionResponse` plus a list of corrections made.

All checks are deterministic code. No LLM calls.

## Design decisions

### Pure function, no side effects

`enforceConformance()` takes an `ExtractionResponse` and returns a new
`ExtractionResponse` plus a `ConformanceReport`. It does not mutate
the input. The report lists each correction so the pipeline can log
what was fixed.

### Corrections, not rejections

Where possible, fix the issue rather than rejecting the element. For
example, remove empty populations rather than failing the entire
extraction. The `ConformanceReport` records what was changed so the
modeler has visibility.

### Runs before parseDraftModel

The parser already handles some invalid input (skipping bad
constraints, recording warnings). The conformance step reduces noise
by catching structural issues earlier, before the parser's more
complex resolution logic runs. This means cleaner warnings and fewer
false positives in the parser output.

## Conformance checks

| # | Check                                                         | Action                                                                    |
| - | ------------------------------------------------------------- | ------------------------------------------------------------------------- |
| 1 | Population with empty `instances`                             | Remove the population entry                                               |
| 2 | Population referencing nonexistent fact type                  | Remove the population entry                                               |
| 3 | Population duplicating a value constraint                     | Remove if all instance values match the value constraint on the same role |
| 4 | Constraint with role players not in `object_types`            | Remove the constraint                                                     |
| 5 | Constraint arity mismatch                                     | Remove (e.g., ring with != 2 roles, frequency with != 1)                  |
| 6 | `is_preferred` on non-identifier fact type                    | Clear the `is_preferred` flag                                             |
| 7 | Duplicate constraints                                         | Remove the duplicate (same type, fact_type, roles)                        |
| 8 | Entity `reference_mode` without matching identifier fact type | Record as warning (informational, cannot fix automatically)               |

## Types

```typescript
interface ConformanceCorrection {
  readonly category: string; // e.g. "empty_population", "invalid_role_player"
  readonly description: string; // Human-readable explanation
  readonly element?: string; // Name of the affected element
}

interface ConformanceResult {
  readonly response: ExtractionResponse; // Cleaned extraction
  readonly corrections: readonly ConformanceCorrection[]; // What was fixed
}
```

## Integration

In `TranscriptProcessor.ts`, between JSON parsing and model
construction:

```typescript
extraction = parseExtractionResponse(parsed);
const { response: cleaned, corrections } = enforceConformance(extraction);
const result = parseDraftModel(cleaned, modelName);
// corrections are appended to result.warnings
```

The same call is added to `parseExtractionFromJson()` for consistency.

## Files

### New files

- `packages/llm/src/ExtractionConformance.ts` -- conformance function
- `packages/llm/tests/ExtractionConformance.test.ts` -- tests

### Modified files

- `packages/llm/src/TranscriptProcessor.ts` -- call `enforceConformance()`
- `packages/llm/src/index.ts` -- export new function and types

## Test coverage

One test per conformance check from the table above, plus:

- Clean extraction with no issues passes through unchanged
- Multiple corrections in the same extraction are all applied
- Corrections are recorded with descriptive messages
- Integration: `processTranscript` with mock client producing
  invalid extraction returns cleaned model with correction warnings

## Success criteria

- Empty populations are removed before reaching the parser
- The clinic-appointments transcript no longer produces "Cannot
  convert undefined or null to object" warnings
- All existing tests continue to pass
- Corrections are visible in the pipeline output (warnings)
