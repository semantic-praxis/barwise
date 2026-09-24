# An Issues tab in the diagram view that lists what is wrong with the model and fixes it in one click

Status: Draft -- no workstream implemented

Created: 2026-09-24
Last-updated: 2026-09-24
Tracking: barwise-1061 (related bug found while grounding: barwise-1062)

The diagram view gains an **Issues** tab that lists validation
diagnostics, export gaps and, on demand, AI review suggestions, and
offers a one-click fix wherever the remedy is unambiguous. Fixes are
proposed by pure functions in `@barwise/core` and applied as small,
undoable text edits to the open `.orm.yaml`, never by re-serializing
the file, because every re-serialization path in the repository
reformats the user's file and drops its comments (measured below).

## Principle

**Determinism in the core, with orthogonality at the edges.** What an
issue is and how to fix it are questions about the model, so they
belong in `core`, as pure functions a CLI command or MCP tool could
call later. Where the fix lands -- an editor buffer, with undo -- is the
extension's concern. Today neither half exists: a core `Diagnostic` is
`{ severity, message, elementId, ruleId }` with no remedy, and the
extension surfaces diagnostics only in VS Code's Problems panel, with no
quick fix.

**Explicit over implicit.** A fix is declared per rule, in one registry,
and states whether it applies as is, needs a choice among listed
options, or needs a typed value. Nothing infers a fix from a message
string.

## What exists today (grounded 2026-09-24)

| Piece                                            | State                                                                                                                                                                             |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/src/validation/Diagnostic.ts`              | `severity`, `message`, `elementId`, `ruleId`. No fix.                                                                                                                             |
| `vscode/src/server/DiagnosticsProvider.ts`       | Runs `ValidationEngine` in the language server; positions each diagnostic with `YamlSourceMap`. No code actions registered.                                                       |
| `vscode/webview` tabs                            | Diagram, Verbalization, Fact Population, YAML, SQL DDL. Content computed on the host (`src/diagram/tabPanels.ts`) and shipped with `setGraph`. The webview never edits the model. |
| `core/src/annotation/exportAnnotationMap.ts`     | Export-gap TODOs keyed by element id; shown in the diagram inspector's Annotations panel.                                                                                         |
| `llm/src/review/reviewModel.ts`                  | `ReviewSuggestion { category, severity, element?, description, rationale }`; `element` is a name, not an id. No structured edit.                                                  |
| `vscode/src/diagram/DiagramPanel.ts:311,344,371` | Saves layouts and views by re-serializing the whole file with `fs.writeFileSync` (barwise-1062).                                                                                  |

**Why fixes cannot re-serialize.** Over the 84 tracked `.orm.yaml`
files (76 load strictly; 21 of those have comments). Every number in
this section comes from `node packages/core/scripts/fix-planning-audit.mjs`
(run from `barwise/` after `npm run build`), at base f8f90a5c:

| Write-back path                               | Files unchanged | Comments kept                   |
| --------------------------------------------- | --------------- | ------------------------------- |
| `OrmYamlSerializer` round trip                | 0 of 76         | 0 of the 21 files with comments |
| `yaml` `parseDocument(t).toString()`          | 26 of 84        | kept, but 30,128 lines reflowed |
| same, with `lineWidth: 0, minContentWidth: 0` | 42 of 84        | kept, but 7,081 lines reflowed  |

A fix that rewrites half a user's file to add one line is not a fix
anyone will accept. The edit has to touch only the span it changes.

**Which rules to fix first.** Diagnostic counts over the same models
(`ValidationEngine`, lenient load, all 84 load):

| Count | Rule                                          | Fix shape (see WS1)                                   |
| ----: | --------------------------------------------- | ----------------------------------------------------- |
|   321 | `completeness/missing-object-type-definition` | input: definition text                                |
|   188 | `structural/binary-missing-inverse-reading`   | input: reading, prefilled `"{1} <inverse> {0}"`       |
|   148 | `completeness/missing-preferred-identifier`   | choice: which uniqueness constraint becomes preferred |
|    68 | `completeness/isolated-object-type`           | apply: mark the object type `independent`             |
|    55 | `completeness/missing-value-type-data-type`   | choice: a conceptual data type (plus length/scale)    |
|    27 | `completeness/multiple-preferred-identifiers` | choice: which one stays preferred                     |

These six are 807 of the 950 diagnostics. `constraint/spanning-all-roles`
(81 informational, 3 warnings) and `completeness/fact-type-without-constraints`
(34) are next but need a modeling decision a button should not make;
they show with "go to" only in the first cut.

## Scope

In scope, as EARS requirements:

- **R1.** When the diagram view is open, the Issues tab shall list every
  validation diagnostic and every export-gap TODO for the model, grouped
  by severity, filterable by rule and element, and updated whenever the
  document changes.
- **R2.** When the user selects an issue, the view shall highlight the
  element in the diagram and reveal its YAML location in the editor.
- **R3.** When an issue's rule has a registered fix, the tab shall offer
  it. An `apply` fix runs on click; a `choice` fix shows its options; an
  `input` fix shows a field, prefilled where the fix supplies a default.
- **R4.** When a fix runs, the extension shall apply it as a
  `WorkspaceEdit` over the open document that changes only the spans the
  fix names, so that one undo reverts it and comments and formatting
  outside those spans are byte-identical.
- **R5.** When the user asks for an AI review, the tab shall run the
  existing `review` capability and list its suggestions under their own
  heading, marked as AI-generated, with "go to" where the named element
  resolves.
- **R6.** Core shall expose `proposeFixes(model, diagnostic)` and
  `planFixEdits(yamlText, fix, input?)`, both pure: the same inputs
  always give the same proposals and the same edits.

Out of scope:

- **Fixes for AI review suggestions.** A suggestion has no structured
  edit, only prose. Turning prose into edits needs the language model,
  which is what you chose against for fixes; see D3.
- **Population violations** (`population/*`, 5 occurrences). The fix is
  usually "delete this sample row", which is destructive; go-to only.
- **CLI and MCP surfaces for fixes.** Core's API makes them cheap later;
  see D4.
- **barwise-1062** (layout save strips comments). It will use WS1's edit
  planner, but it is its own change.

## Should a fix be a model operation or a YAML edit? (resolved: both, in that order)

A fix is computed against the **model** -- "set the data type of value
type X", "mark constraint C preferred" -- because that is where the rule
reasoned and where a test can check the result validates. It is applied
as a **YAML span edit**, because that is the only write-back that keeps
the user's file (table above). So core has two pure steps: a rule's fix
provider turns a diagnostic into `FixProposal`s over model ids, and one
planner turns a proposal into text edits against the document, locating
elements by `id` in the YAML AST. Each fix is tested both ways: the
patched text deserializes to a model where the diagnostic is gone, and
every byte outside the edited spans is unchanged.

## Target architecture

```ts
// @barwise/core/fix -- src/fix/ (new subpath export, pure)
type FixOp = // what changes, in model terms
  | { kind: "setField"; elementId: string; field: "definition" | "data_type" | "independent"; value: unknown; }
  | { kind: "addReading"; factTypeId: string; reading: string; }
  | { kind: "setPreferred"; constraintId: string; preferred: boolean; };

interface FixProposal {
  readonly ruleId: RuleId;
  readonly elementId: string;
  readonly title: string; // "Mark Customer independent"
  readonly needs:
    | { kind: "none"; }
    | { kind: "choice"; options: readonly { label: string; value: string; }[]; }
    | { kind: "text"; default?: string; }
    | { kind: "dataType"; };
  readonly ops: (input?: string) => readonly FixOp[];
}

interface TextEdit { readonly start: number; readonly end: number; readonly newText: string; }

proposeFixes(model: OrmModel, d: Diagnostic): readonly FixProposal[];
planFixEdits(yamlText: string, ops: readonly FixOp[]): readonly TextEdit[];
locateElement(yamlText: string, id: string): { start: number; end: number; } | undefined;
```

```
barwise-vscode (host)                         webview (thin view)
  IssuesPanelData = diagnostics                 Issues tab: grouped list, filter,
    + export gaps + review suggestions            fix buttons / choice / input
    + proposals (serialized, no functions)   <-- setGraph carries IssuesPanelData
  on "applyFix"(issueId, input):             --> posts applyFix / goToIssue / runReview
    ops = proposal.ops(input)
    edits = planFixEdits(document.getText(), ops)
    vscode.workspace.applyEdit(WorkspaceEdit(edits))   // undoable, buffer is truth
```

`locateElement` moves the id-to-node walk out of
`vscode/src/server/YamlSourceMap.ts` into core, and `YamlSourceMap`
delegates to it, so the language server's diagnostic positions and the
fix planner cannot disagree about where an element is (shared, per the
must-agree rule; no parity entry needed).

## Alternatives considered

- **Re-serialize the model after a fix.** Simplest and already done by
  `DiagramPanel`. Rejected: 0 of 76 files survive it and all comments
  are lost (table above).
- **`yaml` Document edit plus `toString()`.** Keeps comments, but still
  reflows 42 of 84 files with the most permissive options. Rejected for
  the same reason; the AST is still used to _locate_ spans.
- **LSP code actions only (lightbulb in the YAML editor).** Cheap, and
  worth adding later from the same `proposeFixes`, but it does not give
  the list-and-triage view you asked for, and a `choice`/`input` fix is
  awkward as a lightbulb. D2 covers doing both.
- **A sidebar tree view instead of a webview tab.** Native look, but it
  separates issues from the diagram highlight that R2 relies on, and a
  tree cannot host an input field. Rejected for the first cut.

## Workstreams (each independently shippable)

Written under the recommended option of each open decision (D1-D4); a
different call changes the part that names it. Ordered by dependency:
WS1 has no UI and ships alone; WS2 needs WS1; WS3 and WS4 need WS2 and
not each other.

### 1. Core: fix proposals and the span-edit planner

New `core/src/fix/`: `FixProposal`, `FixOp`, a registry
`Partial<Record<RuleId, FixProvider>>` with the six providers in the
table, `proposeFixes`, `planFixEdits` and `locateElement`. The planner
handles exactly the `FixOp` kinds the six providers emit: set or insert
a scalar field on a mapping found by `id`, append to a `readings`
sequence, set or remove `is_preferred` on a constraint. Inserted text
takes its indentation from the target mapping's existing keys.
`YamlSourceMap` delegates to `locateElement` in the same PR.

Acceptance, per provider, over a fixture and over every tracked model
where the rule fires: applying the planned edits (a) yields a document
that deserializes, (b) no longer raises that diagnostic for that
element, and (c) is byte-identical outside the edited spans. A
property test over `planFixEdits` checks (c) on generated documents.

### 2. VS Code: the Issues tab with validation diagnostics

Host computes `IssuesPanelData` beside `buildTabPanels` and ships it
with `setGraph`: diagnostics, their serialized proposals (title, needs,
options -- no functions), and a stable issue id. Webview adds the Issues
tab (count badge in the tab label), grouping, filtering, and the three
fix controls. Messages `applyFix`, `goToIssue`. The host applies fixes
through `vscode.workspace.applyEdit` against the open document (opening
it if needed), never `fs.writeFileSync`; the existing change listener
refreshes the tab.

Acceptance: on a model with each of the six rules firing, every fix
applies with one undo step, the issue disappears after the refresh, and
the file's comments survive. R2's go-to reveals the YAML range from
`locateElement`.

### 3. Export gaps in the tab (provisional: not yet grounded)

Add `collectOpenQuestionAnnotations` output as a second source. A
data-type or description gap on a value type maps to the same
`missing-value-type-data-type` / `missing-object-type-definition` fix,
so export gaps get fixes with no new provider. A gap on a key column
depends on `dbt-key-type-fidelity.spec.md` (identifier value types); it
shows go-to only until that lands.

### 4. AI review suggestions, on demand (provisional: not yet grounded)

A "Run AI review" button calls the review capability the extension
already registers as a language-model tool; results are listed under
their own heading and not persisted. Suggestions whose `element` name
resolves get go-to; none gets a fix (D3). No network or model call
happens unless the button is pressed.

## API and migration impact

- New subpath export `@barwise/core/fix` (a `src/fix/index.ts` barrel
  listed in `package.json` `exports`, per `packages/core/CLAUDE.md`):
  `proposeFixes`, `planFixEdits`, `locateElement`, `FixProposal`,
  `FixOp`. Nothing is added to the root barrel. `Diagnostic`
  is unchanged; fixes are looked up by `ruleId`, so no rule's output
  changes.
- `YamlSourceMap` keeps its interface and delegates.
- Capability matrix: add a row, `fix (one-click remedies)`, VS Code yes,
  CLI and MCP no, divergence marked per D4 -- in WS2's commit, since the
  table must agree with the surfaces in the same commit.
- `vscode/tests/unit/toolRegistration.test.ts` is untouched: no new
  language-model tool.

## Open decisions (for review)

- **D1. Where the tab lives.** (A) A sixth tab in the diagram webview,
  beside Verbalization. (B) A separate webview panel. (C) A sidebar
  tree. **Recommendation:** A -- it reuses the host-computed-content
  pattern and the diagram highlight R2 needs.
- **D2. Also offer the same fixes as quick fixes in the YAML editor?**
  The language server would call `proposeFixes`; `choice` and `input`
  fixes become a quick pick or input box. **Recommendation:** yes, as a
  follow-up after WS2, not in this spec's workstreams.
- **D3. AI review suggestions: go-to only, or AI-proposed edits
  reviewed as a diff?** You chose deterministic one-click fixes, which
  rules out the second as the default. **Recommendation:** go-to only
  now; revisit once the review prompt can emit structured `FixOp`s that
  core validates before applying.
- **D4. CLI and MCP.** `barwise fix` and an MCP `fix_model` tool would
  be thin over the same core API. **Recommendation:** mark the gap
  deliberate in the matrix for now ("an interactive, per-issue choice"),
  and file a follow-up for a non-interactive `barwise fix --rule <id>`
  for `apply`-shape fixes.

## Risks and testing

- **The planner is the risk peak.** A wrong span corrupts the user's
  file. Mitigations: acceptance (a)-(c) run over every tracked model;
  the host re-validates the patched text before applying and refuses a
  fix whose result does not deserialize; edits go through the editor so
  undo always works.
- **Stale proposals.** The tab can show a fix computed against an older
  buffer. The host recomputes proposals from the current text at
  `applyFix` time and refuses if the issue no longer exists.
- **YAML styles the planner has not met** (flow mappings, anchors). The
  planner refuses rather than guesses, and the tab shows "fix
  unavailable for this file's formatting" with go-to.
- Per workstream: `npm run build` from `barwise/`, then core and vscode
  suites, then `npm run ci:local`.

## Non-goals

- No change to validation rules or their messages.
- No auto-fix-all. Each fix is one user action; a bulk mode can come
  later once single fixes have a track record.
- No change to the diagram's layout-save path (barwise-1062).
