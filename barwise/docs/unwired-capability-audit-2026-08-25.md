# Unwired-capability audit, 2026-08-25

Second sweep, following `unwired-capability-audit-2026-08-20.md`. That
one was prompted by the capability matrix asserting a surface parity
that had not held for two years. This one is prompted by a different
observation: over four sessions the same defect kept arriving one
instance at a time, and meeting it that way is more expensive than
looking for all of it at once.

**Result: three unwired capabilities, one stale type member, and one new
audit axis that needs its own pass. The capability matrix is accurate.**

## The shape being hunted

Every instance found in the last week has one form: **a seam designed
for N consumers and connected to fewer than N**, surviving because the
gap degrades gracefully instead of failing.

| instance                                          | how it degraded            |
| ------------------------------------------------- | -------------------------- |
| `prompt eval` never consulting `builtinArtifacts` | fell back to the default   |
| `PromptSurface` declaring two surfaces, one wired | one branch never taken     |
| `buildCodeExtractionPrompt` with no call site     | dead code compiles         |
| `elementCount` recorded, nothing reading it       | a field nobody queries     |
| `--max-calls` reaching only GEPA                  | a flag that enforced       |
| `prompt artifact` refusing `--surface review`     | an error that read correct |

None of these throws in normal operation. That is why the existing
machinery -- strict TypeScript, twelve-package build ordering, ~2,400
tests, lint, CI -- cannot see them: it has already eliminated
everything that fails loudly, so the residue is definitionally the
class it cannot detect.

## Method, and what each pass is worth

1. **Value exports with no consumer.** Parse each package's public
   barrel, drop type-only exports (they legitimately serve external npm
   consumers), and look for the remaining names anywhere in `src`.
   Raw output was 119 names and almost all noise -- a name used inside
   its own package is fine for a published library. The signal is
   **exported, and called nowhere in `src` except the file defining
   it**. That narrowed to four, of which three are real.
2. **Union members handled in fewer places than declared.** The
   `PromptSurface` shape, generalised. Most string-literal unions in
   this repo are data vocabularies (NORMA XML, constraint kinds) where
   every member is a legitimate value in a switch. The interesting ones
   are _capability_ unions, where a member is a feature needing wiring
   at several layers.
3. **The capability matrix against reality.** Hand-maintained, and
   wrong once before.
4. **Tests that pin the wrong behaviour.** New, and the sharpest of the
   four. Opened by `#338`; see Finding 5.

## Findings

### 1. `parseExtractionFromJson` has no production caller (barwise-856)

Exported from `@barwise/llm`, exercised only by
`tests/TranscriptProcessor.test.ts`. Nothing in `src` anywhere calls it.

It is not dead code, though -- it is a **documented process with no
implementation**. `packages/promptlab/CLAUDE.md` states as a standing
rule that "references are generated, not hand-written... produced by
running the recorded payloads through `parseExtractionFromJson` and
serializing -- they cannot drift from what the pipeline actually
builds." That rule is the reason the seven train references can be
trusted. Nothing automates it, so the guarantee rests on whoever last
did it by hand having done it correctly.

This is live work, not archaeology: barwise-845 requires generating
references for the three dev cases, and that is exactly this procedure.
Whoever picks it up will either write the script or do it by hand and
leave the next person in the same position.

### 2. `computeLayoutMetrics` is computed by nothing (barwise-857)

Exported from `@barwise/diagram`, exercised only by
`tests/layout/metrics.test.ts`. Reports `nodeOverlapCount` and the rest
-- layout quality measures -- to no caller.

Same shape as the eval metric before promptlab existed: a measurement
built without the thing that reads it. Either wire it to a diagram
report or a layout regression gate, or delete it. Deleting is a
legitimate answer and cheaper than the third rediscovery.

### 3. `ParseLevel` declares an `"llm"` tier that cannot exist (barwise-858)

```ts
/**
 * - "sqlglot": Structural AST parsing via the optional sqlglot sidecar
 * - "regex":   Lightweight regex-based pattern extraction.
 * - "llm":     Raw SQL sent to LLM for interpretation.
 */
export type ParseLevel = "sqlglot" | "regex" | "llm";
```

`"llm"` is never produced by any code and never branched on. The
module docstring describes "the SQL parsing cascade (sqlglot sidecar ->
regex -> LLM fallback)" -- a three-tier cascade with two tiers.

Worse than unused: this type lives in `@barwise/core`, where the
determinism rule forbids exactly the thing the member describes. Core
could never produce it. So the docstring reads as a description of the
system and is a description of an intention, which is the failure the
spec convention exists to prevent.

Either drop the member and fix the docstring, or state where the LLM
tier would live if it is still wanted -- one layer out, per the rule.

### 4. `buildCodeExtractionPrompt` (barwise-811, already tracked)

Confirmed still unwired. No call site; tests only.

## Negative results

Worth recording, because a sweep that only reports hits gives no sense
of its own coverage.

- **The capability matrix is accurate.** Checked row by row against the
  CLI's registered commands and the MCP tool modules. Every `yes`
  holds, every gap is one the table marks deliberate, and there is no
  unmarked gap. It was wrong for two years and has stayed right since
  `cli-surface-parity.spec.md`.
- **Most unused exports are types**, which serve external npm consumers
  and are not evidence of anything.
- **Most string-literal unions are data vocabularies**, not
  capabilities. `ParseLevel` was the only capability union with an
  unimplemented member.
- **Swallowed errors are all deliberate and commented.** Four
  comment-only `catch` blocks, each a genuine "file may not exist"
  probe.

## Finding 5: tests that approve the wrong behaviour (barwise-859)

A new axis, and the one this sweep is least able to close.

`#338` fixed `prompt artifact` refusing `--surface review`, which had
been wrong since barwise-847 made review artifact-driven. The gap
survived a green suite because a test **asserted the refusal was
correct**:

```ts
it("rejects a surface it cannot print", ...)
  expect(stderr).toContain("extraction only");
```

That is worse than an untested gap. An untested gap is invisible; this
one was visible, described, and pinned as a requirement. Any reviewer
reading that test would have concluded the behaviour was intended.

**The one heuristic that works**, tried here: expected error strings
containing "yet", "only", "not supported", "unsupported". "Yet" is the
strongest tell -- it means _temporary_, and a test pinning a temporary
state is precisely the shape.

Four hits, one real:

| hit                                                         | verdict                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| `prompt.test.ts:117` "extraction only"                      | **real** -- `prompt schema --surface review`, barwise-855 |
| `OrmYamlAnnotator.test.ts:184` "not yet supported"          | false positive -- test-supplied fixture text              |
| `DdlDialectExport.test.ts:136` "not supported by snowflake" | false positive -- true of Snowflake                       |
| `Phase2ConstraintVerbalizer.test.ts:102` "if and only if"   | false positive -- verbalization prose                     |

**The discriminator is whether `src` produces the string or the test
supplies it.** Three of four hits are the test feeding its own input.

That heuristic only catches tests pinning an _error_. It cannot catch a
test pinning a wrong _value_, a wrong fallback, or an assertion that
passes for the wrong reason -- and `CaseScore.floored` (barwise-840)
was that second kind: mutating it to always return `false` was caught
by nothing, because the report tests supplied the count as a literal
and so asserted the consumer and never the computation. Finding those
needs mutation testing, not grep, which is why barwise-859 is a work
item rather than a finding.

## What this sweep cannot see

- A capability wired to the wrong thing (it has a consumer, so it
  passes every check here).
- A test that passes for the wrong reason.
- A fallback that is correct today and becomes wrong when a variant is
  added, which is what `prompt eval` was for months.
- Anything in `packages/vscode`, whose commands are registered through
  VS Code's own API and are not reachable by these greps.

## The invariant worth enforcing

One rule covers every instance in the table at the top:

> **Every declared capability has a consumer, and every fallback says
> it fell back.**

Both halves are mechanically checkable, and neither is checked today.
The second half is now honoured by hand in `prompt eval` and
`prompt artifact` -- both name the provider, model and surface that
matched nothing rather than printing a default silently. Making it a
convention rather than two call sites is the follow-up worth having.
