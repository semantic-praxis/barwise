# Diagram Test Coverage: Cover Untested Features

Status: Accepted
Tracking: REPO_REVIEW-2026-06.md (diagram coverage follow-up from #3 /
ci-hardening.spec.md; overlaps T5)

## Problem

Enabling coverage enforcement (PR #103) revealed `@barwise/diagram`
sitting at ~81% with its threshold lowered to an honest floor. The gap
was not evenly spread: several features shipped during the diagram
modernization with no test coverage at all.

Per-file analysis (before):

- `DiagramGenerator.ts` -- 72% statements, **14% branches**: the
  `focusEntityId`/`hopCount` neighborhood path and the `ghostNodeIds`
  rendering path were entirely untested.
- `graph/NeighborhoodFilter.ts` -- the supertype-to-subtype traversal
  direction was untested (only subtype-to-supertype was covered).
- `GraphTypes.ts` / `LayoutTypes.ts` -- pure type modules reported as
  0% (a display artifact: 0 statements), distorting the per-file view.
- `layout/ElkLayoutEngine.ts` -- 71.75% over 1,812 lines: the dominant
  remaining gap.

## Scope

In scope: cover the untested _features_ whose absence the per-file
analysis exposed, and exclude the pure-type modules from the report.

Out of scope: raising `ElkLayoutEngine.ts` coverage. It is the A1
"god file" decomposition target; testing the monolith's internal branch
paths is low-value churn that the decomposition (and the T5 visual /
golden-SVG regression work) should address instead. It caps the
statement aggregate, so the statement floor stays put while the branch
floor ratchets up.

## Approach

- Exclude `graph/GraphTypes.ts` and `layout/LayoutTypes.ts` (type-only,
  no runtime code) from coverage, alongside the existing `index.ts`
  exclusion -- coverage should measure testable code.
- Add `DiagramGenerator` tests for focus/neighborhood filtering (with an
  explicit `hopCount`, the default, and the unfiltered case) and for
  `ghostNodeIds` rendering (`data-ghost` marker).
- Add a `NeighborhoodFilter` test for the supertype-to-subtype
  direction.
- Ratchet the branch threshold 78 -> 82 to lock in the gain; keep the
  statement/line/function floors (ElkLayoutEngine-capped).

## Result

`DiagramGenerator.ts` and `NeighborhoodFilter.ts` reach 100%; branch
coverage rises from 80.8% to ~84.9%. The added tests exercise real
features (focus filtering, ghost preview nodes, subtype neighborhoods)
that were shipping unverified.
