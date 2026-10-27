# Surface capability parity

Scope: architecture
Date: 2026-10-12
Tracking: barwise-ubc, barwise-0wa, barwise-1fr, barwise-1005, barwise-xpt,
docs/specs/cli-surface-parity.spec.md,
docs/specs/getting-started-guides.spec.md

## Context

One `@barwise/core` powers three surfaces -- the CLI, the MCP server
and the VS Code extension -- and a capability that reaches two of them
is either a decision or an omission nobody wrote down. The root
`CLAUDE.md` once claimed parity while `review` and `merge` were missing
from the CLI (`docs/unwired-capability-audit-2026-08-20.md`), and later
marked seven capabilities absent from VS Code, as deliberate, while the
extension registered all seven (barwise-988). Both claims survived
because nothing checked them. The cli-surface-parity spec holds the
reasoning for recording divergence; the getting-started-guides spec
holds why user docs map names rather than copy the matrix. On
2026-10-12 the owner directed that MCP and VS Code mirror the CLI, with
each remaining gap closed or kept for a reason the owner approves
(barwise-0wa).

## Decision

1. **The capability matrix in the root `CLAUDE.md` records which
   surface reaches which capability, and an unmarked gap is a bug.** A
   gap that stays is marked `deliberate` with its reason, and the reason
   is one the owner approved.
2. **A change to a surface's reach updates the matrix in the same
   commit.** The surface change is incomplete until the table agrees
   with it.
3. **"Yes" for VS Code means reachable from the editor**, by a
   `contributes.commands` palette entry or a language-model tool
   registered by `ToolRegistration.ts`. A "yes" that rests on the tool
   registration is qualified by `barwise.enableMcpServer`, which
   defaults on.
4. **The tool lists behind the MCP and VS Code columns are pinned.**
   A test on each surface asserts its complete sorted tool list with
   `toEqual`.

## Consequences

- Decision 4 is the one with a gate: `mcp/tests/serverSpawn.test.ts`
  and `vscode/tests/unit/toolRegistration.test.ts` fail when a tool is
  added or removed without updating their list. They run in CI through
  `npm run test:coverage` (`if: steps.changes.outputs.docs_only !=
  'true'`).
- No test reads the matrix, so decisions 1 to 3 have no gate. A tool
  added to the code and to its pinned list leaves the matrix row
  unchanged and the suite green; the root `CLAUDE.md` sentence saying
  such a change "fails until this table is updated" overclaims, and a
  drift test over the MCP and VS Code columns is one way to close it
  (barwise-1005). The CLI column (`commandRouting.test.ts` pins only the
  19 entries of the CLI's own table), the palette entries and the
  option rows are checked by nothing, and two other documents imply the
  matrix is checked (barwise-xpt). Decisions 1 and 2 are on the `pr-review`
  checklist ("When a surface changed"); decision 3 is on no checklist.
- The matrix breaks decision 1 today, all under barwise-0wa and its
  audit, `docs/cli-surface-audit-2026-10-12.md`:
  - `project init` reads `under review`, so `CLAUDE.md`'s "every
    remaining gap is marked deliberate" is false;
  - the `gym` row says `deliberate`, but `modeling-gym.spec.md` calls
    VS Code "a later workstream", and no owner approved a reason;
  - commands with no row (`gym show`, `import batch`), a command under a
    `none` row that two surfaces lack (`lineage show`), and missing
    options under `none` rows (no `--output` equivalent on MCP import and
    merge, no project-wide MCP export); also transcript-import options
    (barwise-6n8) and project awareness (barwise-rb4);
  - decision 3's definition hides that VS Code's Import and Export
    pickers offer only some registered formats (barwise-i22).
- Rows record reach, not behaviour (barwise-1fr). Known divergences
  under `none` rows: MCP `validate_model` skips the CLI's cross-domain
  project rules (barwise-0wa.qh3), only `barwise export` records lineage
  (barwise-ace), and VS Code's transcript tool reads a file path as
  transcript text (barwise-0wa.pte).
- User docs carry only a name map, not a second matrix. A
  `gettingStartedDocs.test.ts` in cli, mcp and vscode checks each name
  they cite against that surface; it checks names, not reach.
- Until architecture-index WS5 replaces them with links, the root
  `CLAUDE.md` matrix section and its cli bullet, the `pr-review`
  checklist ("When a surface changed"), `assertion-audit` rule 6,
  `duplication-audit` rule 5, `REVIEW.md` (barwise-1fr item), and the
  headers of the two pinned tests also state this rule (barwise-ubc,
  WS5).
