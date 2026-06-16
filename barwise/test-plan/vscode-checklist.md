# VS Code extension -- manual test checklist

The interactive surface can't be driven by a script, so this is a manual
walkthrough. Work top to bottom; check each box as you confirm it, and for
anything that misbehaves, capture it with the bug template at the bottom.

## Setup

- [ ] Build/package the extension and install the VSIX (or launch the
      Extension Development Host with `F5` from the `packages/vscode` folder).
- [ ] Open a folder containing `.orm.yaml` files -- the `test-plan/fixtures`
      directory and `examples/` are good targets.
- [ ] Confirm the extension activates when an `.orm.yaml` file is opened
      (no activation errors in the Output panel -> "Barwise").

## Live diagnostics (LSP)

- [ ] Open `test-plan/fixtures/external-uniqueness-violation.orm.yaml`:
      the external-uniqueness violation is flagged with a squiggle, and the
      message matches the CLI (`"R2" and "R1" share the same combination`).
- [ ] Open `test-plan/fixtures/broken.orm.yaml`: the dangling object-type
      reference is reported.
- [ ] Open a clean model (`external-uniqueness.orm.yaml`): no error squiggles.
- [ ] Edit a clean model to introduce an error (e.g. delete a `reference_mode`):
      the diagnostic appears within a moment, **live**, without saving.
- [ ] Fix the error: the diagnostic clears.
- [ ] Hover a diagnostic: the message is readable and points at the right span.

## Commands (Command Palette: "Barwise: ...")

- [ ] **Validate Model** (`barwise.validateModel`) -- runs and reports the same
      result as `barwise validate` on the same file.
- [ ] **Verbalize** (`barwise.verbalize`) -- produces FORML readings; spot-check
      one fact type reads naturally.
- [ ] **Show Diagram** (`barwise.showDiagram`) -- the webview opens and renders
      the ORM diagram for the active model.
- [ ] **Export** (`barwise.export`) -- the format picker lists ddl / openapi /
      avro / dbt; exporting writes the artifact.
- [ ] **Import** (`barwise.import`) -- import flow starts (transcript import
      needs an LLM provider configured in settings).
- [ ] **New Project** (`barwise.newProject`) -- scaffolds a project.

## Diagram webview

- [ ] Diagram renders all object types and fact types of the model.
- [ ] Pan and zoom work on the interactive canvas.
- [ ] **Highlight in Diagram** (`barwise.highlightInDiagram`) from an element
      selects/centers it in the open diagram.
- [ ] **Copy Element Name** (`barwise.copyElementName`) puts the name on the
      clipboard.
- [ ] Reopen the diagram (close + Show Diagram again) -- no stale state or
      duplicate panels; webview survives a window reload.
- [ ] Switch VS Code color theme (light/dark) -- the diagram stays legible.

## Custom views

- [ ] **Create View** (`barwise.createView`) -- creates a named subset view.
- [ ] **Add to View** (`barwise.addToView`) -- adds the selected element(s)
      to a view, and the view diagram reflects the addition.

## Multi-file project

- [ ] Open `examples/auction-project/` -- the project manifest and its domain
      `.orm.yaml` files load.
- [ ] Cross-domain references resolve (no false "missing" diagnostics for
      types defined in sibling domains via the `.map.yaml`).
- [ ] Validation diagnostics span files (an error in one domain surfaces on
      the right file).

## Chat participant

- [ ] Invoke the Barwise chat participant in the Chat view.
- [ ] Ask it to validate / explain the model in the open workspace -- it uses
      the workspace model as context and answers about the actual model.
- [ ] Confirm the sensemaking framing shows through (it surfaces anchors,
      assumptions, or what the constraints rule out -- not just a flat summary).

## Edge cases to poke at

- [ ] Open an empty or whitespace-only `.orm.yaml` -- graceful message, no crash.
- [ ] Open a malformed YAML file -- a parse error, not an extension crash.
- [ ] Run a command with no `.orm.yaml` active -- sensible "no model" message.
- [ ] Rapidly edit and undo a model -- diagnostics keep up, no stuck squiggles.
- [ ] Large model (split the auction monolith and open a domain) -- diagram and
      diagnostics remain responsive.

## Bug capture template

For each issue, record:

```
Modality:  VS Code extension
Action:    <command / interaction>
Input:     <file or model, + a snippet if relevant>
Expected:  <what you expected>
Actual:    <what happened, incl. any Output-panel / Developer Tools error>
```
