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
- **dbt import** -- reverse-engineer ORM models from dbt YAML schemas
- **Model diffing** -- incremental re-extraction merges changes into
  existing models with a fact-by-fact review

## Commands

Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type
"ORM" to see all available commands:

| Command              | Description                                        |
| -------------------- | -------------------------------------------------- |
| ORM: New Project     | Scaffold a new `.orm-project.yaml` and `.orm.yaml` |
| ORM: Validate Model  | Run full structural and constraint validation      |
| ORM: Verbalize Model | Generate natural-language readings                 |
| ORM: Show Diagram    | Open an ORM diagram in a webview panel             |
| ORM: Import...       | Import from transcript or dbt project              |
| ORM: Export...       | Export to dbt, DDL, or other formats               |

## Configuration

| Setting                      | Default                      | Description                                                       |
| ---------------------------- | ---------------------------- | ----------------------------------------------------------------- |
| `barwise.llmProvider`        | `copilot`                    | LLM provider: `copilot` (free with GitHub Copilot) or `anthropic` |
| `barwise.anthropicApiKey`    |                              | Anthropic API key (only when provider is `anthropic`)             |
| `barwise.anthropicModel`     | `claude-sonnet-4-5-20250929` | Anthropic model ID                                                |
| `barwise.copilotModelFamily` |                              | Preferred Copilot model family                                    |

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
