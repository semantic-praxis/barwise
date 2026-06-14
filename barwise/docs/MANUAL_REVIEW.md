# Manual Review Checklist

The automated suite (unit, integration, `validate:examples`, coverage
gates) covers the deterministic core. This checklist covers what those
cannot: real editor behavior, real LLM calls, visual layout quality, and
the downloadable artifacts. Run the section for any interface you
touched; run the whole list before cutting a release.

Two sample models are handy throughout:

- `examples/models/diagram-layout.orm.yaml` -- a layout stress test
  (many entities, subtypes, value types) -- best for diagram checks.
- `examples/transcripts/clinic-appointments.orm.yaml` -- a small,
  readable domain model.

## CLI (`barwise`)

Run from `barwise/` against the built CLI
(`node packages/cli/dist/index.js`) or the release bundle
(`node ~/Downloads/barwise-cli-<ver>.cjs`). Both should behave
identically.

- [ ] `--version` prints the current version; `--help` lists all commands.
- [ ] `validate examples/transcripts/clinic-appointments.orm.yaml` reports valid (exit 0).
- [ ] `validate` on an intentionally broken file reports the errors and exits 1.
- [ ] `verbalize <model>` prints FORML readings for fact types and constraints.
- [ ] `schema <model>` emits DDL; `schema <model> --format json` emits JSON.
- [ ] `diagram <model> --output /tmp/d.svg` writes an SVG that opens in a browser.
- [ ] `export <model> --format <fmt>` works for each registered format (ddl, openapi, avro, ...).
- [ ] `diff <base> <incoming>` reports added/removed/changed elements between two models.
- [ ] `query <model> path <EntityA> <EntityB>` returns a connecting path (the chat bug's query).
- [ ] `describe <model>` summarizes the domain; `--focus <Entity>` narrows it.
- [ ] `import` and `lineage` subcommands print help and run their happy path.
- [ ] An unreadable path or malformed YAML fails with a clear message, not a stack trace.

## MCP server (`barwise-mcp`)

Wire the bundle into an MCP client (Claude Desktop / Claude Code) as a
stdio server: `node ~/Downloads/barwise-mcp-<ver>.cjs`.

- [ ] The client lists the barwise tools (validate_model, verbalize_model, generate_schema, generate_diagram, query_model, diff_models, ...).
- [ ] A tool call with an explicit `source` file path returns the expected result.
- [ ] A tool call with inline YAML in `source` works (no file needed).
- [ ] The `orm-schema://json-schema` resource and the `analyze-domain` / `review-model` prompts are listed.
- [ ] A bad `source` returns a readable error, and the server stays up for the next call.

## VS Code extension

Install the VSIX (`code --install-extension barwise-vscode-<ver>.vsix`)
or run from source with `F5` (the "Run Extension" launch config), then
open a `.orm.yaml` file.

### Language features (LSP)

- [ ] Opening an invalid `.orm.yaml` shows red squiggles on the offending lines (diagnostics).
- [ ] Fixing the error clears the squiggle without reopening the file.
- [ ] Autocomplete suggests object-type and role names where appropriate.
- [ ] Hovering an object-type reference shows its info.

### Commands (Command Palette)

- [ ] _New Project_ scaffolds a new `.orm.yaml`.
- [ ] _Validate Model_ reports validation results for the active file.
- [ ] _Verbalize Model_ opens the verbalization report.
- [ ] _Import..._ runs transcript / code import (see the chat/LLM note below).
- [ ] _Export..._ writes the chosen format.
- [ ] In the model tree: _Highlight in Diagram_, _Copy Name_, _Add to View_, _New View_ each work.

### Diagram webview (the layout facility)

Run _Show Diagram_ on `examples/models/diagram-layout.orm.yaml`. The
diagram opens in a webview panel (the React app). Verify each
interaction; this logic has no automated UI coverage.

- [ ] The diagram renders: entity boxes, fact-type strips between them, edges, constraints.
- [ ] Drag an entity -- it moves, and the connected fact types and edges follow.
- [ ] After a drag, the panel shows unsaved state; _save layout_ persists positions to the `.orm.yaml`.
- [ ] Reopen the diagram -- saved positions are restored (not re-laid-out).
- [ ] Double-click a fact type -- its orientation flips (horizontal <-> vertical).
- [ ] Focus an entity at 1, 2, and 3 hops -- the diagram filters to that neighborhood and widens with each hop.
- [ ] Clear focus -- the full model returns.
- [ ] Load a named view -- only that view's elements show.
- [ ] Show neighbors of a node in a view -- ghost nodes appear; add-to-view promotes a ghost permanently.
- [ ] _Save view_ writes the named view back to the file.
- [ ] Edit the `.orm.yaml` in the editor while the diagram is open -- it live-reloads (debounced).
- [ ] Highlight an element from the model tree -- the diagram focuses/highlights it.

### @barwise chat participant

In Copilot Chat, `@barwise <question>` about a model.

- [ ] With a `.orm.yaml` focused in the editor, `@barwise verbalize this model` works.
- [ ] _Regression for the source bug:_ run _Show Diagram_ first (so the webview is the active panel), then `@barwise` a question -- it resolves the diagram's model instead of erroring "No source provided".
- [ ] Attach a `.orm.yaml` as a chat reference (not open in an editor) and ask about it -- it is used (after chat WS2).
- [ ] Import a transcript via chat -- it uses Copilot with no API key and produces a model.
- [ ] A question with no model anywhere returns the clear "open or attach a file" guidance.

## Diagram layout quality (visual)

Render a few models to SVG (`barwise diagram <model> --output ...`) and
open them. These are aesthetic judgments the metrics/golden guards
approximate but cannot fully replace.

- [ ] Entities are spaced without overlapping boxes or labels.
- [ ] Fact-type strips sit between their connected entities; edges do not cross the strips.
- [ ] Subtypes fan outward from their supertype; value-type "leaves" align cleanly with their hub.
- [ ] Constraints (uniqueness bars, mandatory dots, external/ring) render near the roles they govern.
- [ ] Objectified fact types show their border; ring constraints show the correct glyph.
- [ ] The overall diagram is reasonably balanced -- not a tall thin column or a wide thin strip.

## Release downloads

After publishing a release (or against the rolling `edge` pre-release):

- [ ] Each asset is attached: `barwise-vscode-<ver>.vsix`, `barwise-cli-<ver>.cjs`, `barwise-mcp-<ver>.cjs`, `SHA256SUMS`.
- [ ] `sha256sum -c SHA256SUMS` passes for the downloaded files.
- [ ] The CLI bundle runs standalone: `node barwise-cli-<ver>.cjs --version` prints the release version.
- [ ] The MCP bundle starts and registers with an MCP client.
- [ ] The VSIX installs and activates; the diagram and chat work from the installed build.
- [ ] On a push to `main`, the `edge` pre-release refreshes to the new commit with fresh assets.
