# Surface capability parity

Scope: architecture
Date: 2026-11-04
Tracking: barwise-ubc, barwise-0wa, docs/specs/surface-mirroring.spec.md, barwise-1fr, barwise-1005, barwise-xpt,
docs/specs/cli-surface-parity.spec.md,
docs/specs/getting-started-guides.spec.md,
docs/specs/capability-matrix-check.spec.md
Enforced-by: npm run check:capability-matrix (matrix-records-reach, matrix-same-commit,
vscode-yes-means), tests (pinned-tool-lists), none (barwise-ym8.0pq: pinned-tool-lists),
none (barwise-ym8.wfy: matrix-records-reach), none (barwise-ym8.3nm: matrix-same-commit)

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
2026-10-12 the owner directed that MCP and VS Code mirror the CLI's
toolset, and on 2026-10-13 re-decided the matrix's rows under that
direction (barwise-0wa, `docs/cli-surface-audit-2026-10-12.md`;
Consequences below).

## Decision

1. **The capability matrix in the root `CLAUDE.md` records which
   surface reaches which capability, and an unmarked gap is a bug.** {#matrix-records-reach} A
   gap that stays is marked `deliberate` with its reason; a gap being
   closed is marked `not yet` with the workstream that closes it.
2. **A change to a surface's reach updates the matrix in the same
   commit.** {#matrix-same-commit} The surface change is incomplete until the table agrees
   with it.
3. **"Yes" for VS Code means reachable from the editor** {#vscode-yes-means}, by a
   `contributes.commands` palette entry or a language-model tool
   registered by `ToolRegistration.ts`. A "yes" that rests on the tool
   registration is qualified by `barwise.enableMcpServer`, which
   defaults on.
4. **The tool lists behind the MCP and VS Code columns are pinned.** {#pinned-tool-lists}
   A test on each surface asserts its complete sorted tool list with
   `toEqual`.

## Consequences

- `npm run check:capability-matrix` holds decisions 1 to 3
  (`docs/specs/capability-matrix-check.spec.md`). It reads the matrix,
  `scripts/lib/capability-map.json` (which names, per row and surface,
  what would carry the row's reach) and the registrations themselves: the
  CLI's commander tree and the MCP server's `listTools` from the build,
  VS Code's `contributes` and the extension's `registerCommand` calls
  from source. It fails on a row and map that disagree, a cell the
  registrations contradict (a `no` where the gap has closed included),
  a registration no row names, a palette command contributed and never
  registered, and a Divergence outside this ADR's vocabulary; it refuses
  a missing build. `--static` runs the rows-against-map half
  with no docs-only guard, so a docs-only edit to the matrix is checked;
  the full run follows the build. A command path is covered by a row
  naming it or an ancestor, the matrix's own granularity, so `lineage
  show` and `gym show` still sit under rows that read `none` or `yes`
  (below). Decision 2 is held per pull request head and push to main, not
  per commit (that spec's open decision 1). The bundled MCP server
  provider and the chat participant are not counted as VS Code reach,
  per decision 3; whether they should be is that spec's open decision 3.
- Decision 4 has its own tests: `mcp/tests/serverSpawn.test.ts`
  and `vscode/tests/unit/toolRegistration.test.ts` fail when a tool is
  added or removed without updating their list. They run in CI through
  `npm run test:coverage` (`if: steps.changes.outputs.docs_only !=
  'true'`, so skipped on a docs-only pull request and, like any step,
  once an earlier step fails).
- What remains open: decision 1 at a finer grain than a row (a
  subcommand or option gap under a row that reads `none`; below, and
  `surface-mirroring.spec.md` workstream 1); decision 2 per commit
  (barwise-ym8.3nm); and decision 4's tests, where `check:adr-tests`
  passes on either one of the two and nothing checks the `toEqual`
  form (barwise-ym8.0pq). Decisions 1 and 2 are also on the `pr-review`
  checklist ("When a surface changed").
- The owner re-decided the rows that existed on 2026-10-13, under the
  2026-10-12 direction that MCP and VS Code mirror the CLI (barwise-0wa,
  `docs/specs/surface-mirroring.spec.md`): each now reads `deliberate`
  with the reason the owner approved, or `not yet` with its workstream.
  `migrate`, added since, is to be mirrored (owner, 2026-11-05; that
  spec's workstream 5). What the matrix still cannot show: `lineage show` sits
  under a `none` row although MCP and VS Code lack it, the `gym` row
  reads `yes` for MCP although `gym show` and `--catalog` have no MCP
  counterpart (that spec's workstream 5) and `--emit-misses` has no MCP output path (its workstream 7), and option-level
  gaps (MCP has no `--output` equivalent on import and no project-wide
  export; transcript-import options, barwise-6n8; project awareness,
  barwise-rb4) sit under rows that read `none`. That spec's workstream 1
  turns them into a checked baseline.
- Decision 3 counts any registration as reach, so a "yes" can hide a
  partial one: VS Code's Import and Export pickers offer only some
  registered formats (barwise-i22).
- Rows record reach, not behaviour (barwise-1fr). Known divergences
  under `none` rows: MCP `validate_model` skips the CLI's cross-domain
  project rules (barwise-0wa.qh3), only `barwise export` records lineage
  (barwise-ace), and VS Code's transcript tool reads a file path as
  transcript text (barwise-0wa.pte).
- User docs carry only a name map, not a second matrix. A
  `gettingStartedDocs.test.ts` in cli, mcp and vscode checks each name
  they cite against that surface; it checks names, not reach.
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule: the `pr-review` checklist ("When a surface
  changed"); `assertion-audit` rules 4 and 6; `duplication-audit` rule 5;
  `REVIEW.md` (the barwise-1fr item); and the comments in the two pinned
  tests.
