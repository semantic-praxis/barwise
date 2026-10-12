# Barwise ORM Modeler

Object-Role Modeling (ORM 2) toolkit for data engineers and architects,
integrated into VS Code.

## Features

- **Language support** for `.orm.yaml` files with autocomplete, hover
  documentation, and inline diagnostics
- **Validation** against ORM 2 structural and constraint rules
- **Verbalization** of fact types and constraints in natural language
- **Diagram generation** rendered as SVG in a webview panel
- **LLM transcript import** -- extract an ORM model from a business
  working session transcript using GitHub Copilot or Anthropic
- **dbt and code import** -- reverse-engineer ORM models from a dbt
  project or a TypeScript, Java or Kotlin codebase
- **Model diffing** -- incremental re-extraction merges changes into
  existing models with a fact-by-fact review
- **Copilot Chat** -- the `@barwise` chat participant and `#barwise...`
  tools for validation, export, diff, merge, query, review and more

For a walkthrough, see the
[VS Code getting-started guide](https://github.com/semantic-praxis/barwise/blob/main/barwise/docs/getting-started/vscode.md).

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type
"Barwise" to see the commands:

| Command                            | Description                                                  |
| ---------------------------------- | ------------------------------------------------------------ |
| **Barwise: New Project**           | Create a starter `.orm.yaml` model (one file, not a project) |
| **Barwise: Validate Model**        | Run full structural and constraint validation                |
| **Barwise: Verbalize Model**       | Generate natural-language readings                           |
| **Barwise: Show Diagram**          | Open an ORM diagram in a webview panel                       |
| **Barwise: Import...**             | Import from a transcript, a dbt project, or code             |
| **Barwise: Export...**             | Export to dbt, DDL, or Avro                                  |
| **Barwise: New View...**           | Save a named diagram view of selected object types           |
| **Barwise: Set Anthropic API Key** | Store an Anthropic key in the OS keychain                    |
| **ORM: Analyze Repository**        | Profile a repository and import it                           |

Other import and export formats (DDL, OpenAPI, NORMA, SQL) are reachable
through Copilot Chat as `#barwiseImportModel` and `#barwiseExport`.

## Configuration

| Setting                      | Default                      | Description                                                       |
| ---------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `barwise.llmProvider`        | `copilot`                    | LLM provider: `copilot` (free with GitHub Copilot) or `anthropic` |
| `barwise.anthropicModel`     | `claude-sonnet-4-5-20250929` | Anthropic model ID                                                |
| `barwise.copilotModelFamily` |                              | Preferred Copilot model family                                    |

With `anthropic`, supply the key with **Barwise: Set Anthropic API Key**; it is
stored in the OS keychain, not in settings. The old `barwise.anthropicApiKey`
setting is deprecated and read once to migrate an existing value.

A project-level default LLM model can be set in `.orm-project.yaml`
under `settings.default_llm_model`. The model picker at extraction
time will pre-select this default.

## File Types

- `.orm.yaml` -- ORM model definition (object types, fact types, constraints)
- `.orm-project.yaml` -- Multi-domain project manifest
- `.map.yaml` -- Context mapping between domains

## Requirements

- VS Code 1.101 or later
- GitHub Copilot extension (for LLM features with Copilot provider)
