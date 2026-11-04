# Getting started with barwise

Barwise turns a description of a business domain into a precise conceptual
model, then turns that model into the things a data team builds: DDL, dbt
models, OpenAPI and Avro schemas, and diagrams. The model is a plain YAML file
(`.orm.yaml`) that you keep in version control. It is written in Object-Role
Modeling (ORM 2), which states every rule as a sentence a business expert can
check ("Each SalesOrder is placed by exactly one Customer") before anyone
argues about tables.

You can work with barwise in three ways. All three run the same engine and
read and write the same files, so you can mix them on one project.

| Surface           | Best for                                                       | Guide                                                                    |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `barwise` CLI     | Scripts, CI checks, and anyone who lives in a terminal         | [docs/getting-started/cli.md](barwise/docs/getting-started/cli.md)       |
| VS Code extension | Editing models by hand with live checks, diagrams, and Copilot | [docs/getting-started/vscode.md](barwise/docs/getting-started/vscode.md) |
| MCP server        | Letting an AI assistant (Claude, Cursor, Copilot) do the work  | [docs/getting-started/mcp.md](barwise/docs/getting-started/mcp.md)       |

Each guide follows the same path, in the same order, so you can read one and
skim the others: install, start a model, check it, generate artifacts, change
it safely, and grow it into a multi-domain project.

## Install

Prebuilt artifacts for every merge to `main` are on the
[`edge` release](https://github.com/semantic-praxis/barwise/releases/tag/edge);
versioned builds are on the [releases page](https://github.com/semantic-praxis/barwise/releases).

| You want              | Download                        | Then                                                     |
| --------------------- | ------------------------------- | -------------------------------------------------------- |
| The CLI               | `barwise-cli-<version>.cjs`     | `node barwise-cli-<version>.cjs --help`                  |
| The VS Code extension | `barwise-vscode-<version>.vsix` | `code --install-extension barwise-vscode-<version>.vsix` |
| The MCP server        | `barwise-mcp-<version>.cjs`     | point your MCP client at it (see the MCP guide)          |

Each needs Node.js; the version the project tests against is in
[`.nvmrc`](.nvmrc). Building from source, and checking the downloads against
`SHA256SUMS`, are covered in [README.md](README.md).

The barwise packages are not published to npm. Instructions you may find
elsewhere that say `npx @barwise/mcp` or `npm install -g @barwise/cli` do not
work.

## The sample files

The guides use two small files in
[`barwise/examples/getting-started/`](barwise/examples/getting-started/):

- `shop.orm.yaml` -- a hand-written model of customers and sales orders. Use it
  as the starting point when you have nothing yet.
- `shop.sql` -- the same domain as two `CREATE TABLE` statements. Use it to try
  importing an existing database schema.

Neither needs an API key. Only two steps in the whole workflow call a large
language model: extracting a model from a transcript, and the semantic review.

## The workflow, surface by surface

The same steps have different names on each surface. Run a step from this
table, or follow your surface's guide for the details.

| Step                               | CLI                                                | MCP tool                            | VS Code                                                      |
| ---------------------------------- | -------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------ |
| Start from nothing                 | none: copy `shop.orm.yaml`                         | none: copy `shop.orm.yaml`          | **Barwise: New Project**                                     |
| Import a schema or codebase        | `barwise import model`                             | `import_model`                      | **Barwise: Import...** (dbt and code); `#barwiseImportModel` |
| Extract from a transcript (LLM)    | `barwise import transcript`                        | `import_transcript`                 | **Barwise: Import...** (From Transcript); `#barwiseImport`   |
| Profile and import a repository    | `barwise analyze`                                  | `analyze_repository`                | **ORM: Analyze Repository**                                  |
| Check the structure                | `barwise validate`                                 | `validate_model`                    | **Barwise: Validate Model**, plus live squiggles             |
| Read the rules back as sentences   | `barwise verbalize`                                | `verbalize_model`                   | **Barwise: Verbalize Model**                                 |
| Ask precise questions              | `barwise query`, `barwise describe`                | `query_model`, `describe_domain`    | `#barwiseQuery`, `#barwiseDescribe`                          |
| Draw the diagram                   | `barwise diagram`                                  | `generate_diagram`                  | **Barwise: Show Diagram**                                    |
| Generate DDL, dbt, OpenAPI, Avro   | `barwise export --format`                          | `export_model`                      | **Barwise: Export...**; `#barwiseExport`                     |
| Get modeling advice (LLM)          | `barwise review`                                   | `review_model`                      | `#barwiseReview`                                             |
| Compare two versions               | `barwise diff`                                     | `diff_models`                       | `#barwiseDiff`                                               |
| Fold one model into another        | `barwise merge`                                    | `merge_models`                      | `#barwiseMerge`                                              |
| Rename an element                  | `barwise rename`                                   | `rename_element`                    | `#barwiseRename`                                             |
| Show a model's change history      | `barwise history`                                  | none                                | none                                                         |
| Find stale or affected artifacts   | `barwise lineage status`, `barwise lineage impact` | `lineage_status`, `impact_analysis` | `#barwiseLineage`, `#barwiseImpact`                          |
| Split a large model into a project | `barwise project split`                            | `split_model`                       | `#barwiseSplit`                                              |
| Practice ORM with exercises        | `barwise gym list`                                 | `gym_list`, `gym_check`             | none                                                         |

In VS Code, names in bold are Command Palette entries and `#` names are tools
you reference in Copilot Chat. The chat tools are on by default and are
controlled by the `barwise.enableMcpServer` setting.

## Where the surfaces differ

The table above shows the gaps you will notice first. A few differences in
_behavior_ matter more, because the same step does something different
depending on where you run it:

- **Merging writes to different places.** `barwise merge` never changes either
  input file; the MCP tool and the VS Code chat tool write the merged model over
  the base file. That is by design: those two are editing tools, so a merge
  lands in the model you are working on.
- **Re-importing onto an existing file.** Transcript import merges into an
  existing model; the deterministic importers (DDL, dbt, SQL, code) overwrite
  it. Import to a new file and merge when you want to keep hand edits.
- **Validating a multi-domain project.** `barwise validate` on a
  `.orm-project.yaml` also checks the rules between domains, such as a mapping
  that names a missing domain. The MCP and VS Code tools check each domain on
  its own and skip those rules.
- **Only CLI exports are tracked.** `barwise export` records each artifact in
  a lineage manifest; exports from the MCP tool or from VS Code are not
  recorded, so the lineage tools on every surface cannot see them.
- **The VS Code palette offers fewer formats than the engine has.** Importing
  DDL, OpenAPI, NORMA or SQL, and exporting OpenAPI or NORMA, are reachable in
  the editor only through Copilot Chat.

The full list, with the evidence and a tracker issue for each, is in
[the surface parity audit](barwise/docs/surface-parity-audit-2026-10-12.md).
The option-by-option comparison, and the plan to make MCP and VS Code mirror
the CLI, is in [the CLI surface audit](barwise/docs/cli-surface-audit-2026-10-12.md).
Which surface is meant to reach which capability is recorded in the
capability matrix in [CLAUDE.md](CLAUDE.md).

## Learning ORM

Barwise assumes you know, or are willing to learn, a little Object-Role
Modeling. Three places to start:

- [The order-fulfillment tutorial](barwise/docs/tutorial/order-fulfillment.md)
  builds one model step by step and shows, at each step, the bad data the
  model still allows.
- The modeling gym (`barwise gym list`) has short exercises with deterministic
  feedback. For now it needs a source build: the downloaded CLI and MCP files
  cannot find the exercise catalog.
- Terry Halpin and Tony Morgan's _Information Modeling and Relational
  Databases_ is the reference; [the reading guide](barwise/docs/halpin-morgan-3e-reading-guide.md)
  says which chapters to read first.
