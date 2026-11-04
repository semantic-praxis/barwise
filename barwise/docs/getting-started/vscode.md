# Getting started with the barwise VS Code extension

The extension is barwise in the editor. It checks a `.orm.yaml` file as you
type, draws its diagram, and puts the barwise tools in Copilot Chat. This guide
follows the path in [GETTING_STARTED.md](../../../GETTING_STARTED.md): install,
start a model, check it, generate artifacts, change it safely, and grow it into
a project. The extension's own summary is its
[README](../../packages/vscode/README.md).

The examples use the sample files in
[`examples/getting-started/`](../../examples/getting-started/). Open the
folder that holds them as your workspace.

The extension has two ways in, and this guide names both:

- **Command Palette** entries (`Ctrl+Shift+P` or `Cmd+Shift+P`), shown in bold
  with their full title, such as **Barwise: Validate Model**.
- **Copilot Chat**: the `@barwise` chat participant (`@barwise /validate`), and
  tools you reference with `#` in agent mode (`#barwiseValidate`). The chat
  tools act on the model you attached to the chat, or else the `.orm.yaml`
  file in the focused editor, or else the model in the open diagram.

Some capabilities exist only in chat. Without Copilot you still have the
palette, the live checks and the diagram.

## 1. Install and check

Download `barwise-vscode-<version>.vsix` from the
[releases page](https://github.com/semantic-praxis/barwise/releases) and
install it:

```sh
code --install-extension barwise-vscode-<version>.vsix
```

The extension needs VS Code 1.101 or later. To build the VSIX yourself, see
[README.md](../../../README.md).

To check the install, open `shop.orm.yaml`. A **Barwise ORM** icon appears in
the activity bar, and its **Model Browser** lists the file's object types and
fact types.

## 2. Configure a model provider (only for transcripts and review)

Two capabilities call a large language model: transcript import and review.
Everything else runs locally with no account.

By default the extension uses your GitHub Copilot subscription through VS
Code's language-model API, so there is no key to manage;
`barwise.copilotModelFamily` picks a preferred model family. To call Anthropic
directly instead, set `barwise.llmProvider` to `anthropic` and run
**Barwise: Set Anthropic API Key**. The key goes to the operating system's
keychain, never to a settings file that could be committed. (`barwise.anthropicApiKey` is deprecated; the
extension moves any value it finds there into the keychain once.)

## 3. Start a model

### From nothing

Run **Barwise: New Project** and choose where to save. Despite the name, it
creates a single model file, not a multi-domain project: an `.orm.yaml` with
empty `object_types` and `fact_types` lists.

Fill it in by hand. The editor helps: it marks errors as you type, completes
object type ids in `player` fields and the values of `kind` and constraint
`type`, and shows an object type's definition and fact types on hover. The sample
`shop.orm.yaml` shows the shape of a small finished model: `object_types` (the
things in the domain and the values that describe them), `fact_types`
(sentences that relate them), and the `constraints` on each fact type. Element
`id`s only have to be unique within the file.

### From an existing schema or codebase

**Barwise: Import...** offers:

- **From dbt Project**: pick the folder holding `dbt_project.yml` and name the
  model. It writes `<name>.orm.yaml` beside the dbt project folder, replacing
  any file of that name, and logs what it inferred to the **Barwise dbt
  Import** output channel.
- **From TypeScript Project**, **From Java Project**, **From Kotlin Project**:
  pick the project folder; optionally pick an existing model to focus the
  analysis on entities it already names.

**ORM: Analyze Repository** profiles a GitHub repository or a local checkout,
picks the matching importer, and opens the extracted model in a new editor.

DDL, OpenAPI, NORMA and raw SQL import are not in the palette. Ask Copilot in
agent mode instead, for example "import shop.sql as DDL using
#barwiseImportModel", and save the YAML it returns.

An import is a starting point. Verbalize it (step 4) and rewrite the readings
no one would say out loud: the DDL importer, for one, names a foreign-key fact
type after the column.

### From a conversation

**Barwise: Import...**, then **From Transcript**: pick a `.md` or `.txt` file
(the repository ships samples in
[`examples/transcripts/`](../../examples/transcripts/)), name the model, and
pick the model to extract with. The new `.orm.yaml` opens when extraction
finishes, and the **Barwise Transcript Import** output channel lists the
ambiguities the extraction flagged.

If the file already exists, the import does not overwrite it. It shows every
added, changed and removed element with a checkbox; additions and changes start
checked, removals start unchecked.

In chat, `@barwise /import` or `#barwiseImport` does the same extraction.

## 4. Check the model

You get structural checks without asking: errors and warnings appear as
squiggles while you edit, and in the Problems panel. Set
`barwise.showCounterexamplesOnHover` to see, on hover, the smallest sample of
data each constraint rules out.

- **Barwise: Validate Model** runs the full check on the active file and lists
  the results in the **Barwise Validation** output channel.
- **Barwise: Verbalize Model** reads every fact type and constraint back as
  plain sentences, in the **Barwise Verbalization** output channel. This is the
  step that catches modeling mistakes: show the sentences to someone who knows
  the business and ask whether each one is true.
- **Barwise: Show Diagram** opens the ORM diagram beside the editor, with tabs
  for the verbalization, the YAML, the generated DDL, and sample populations.
  Clicking an element in the Model Browser highlights it in the diagram.
- **Barwise: New View...** saves a named diagram of selected object types into
  the model, and **Barwise: Add to View...** (from the Model Browser's context
  menu) adds one more.

In chat, `#barwiseQuery` answers precise structural questions ("which fact
types does Customer play in?") and `#barwiseDescribe` summarizes an entity and
its rules.

## 5. Generate artifacts

**Barwise: Export...** offers:

- **As dbt Project**: pick an existing dbt project folder; it writes
  `models/staging/schema.yml` and one SQL model per table there, the files
  `barwise export --format dbt` writes under `models/`, and no seed files.
- **As DDL**: choose where to save the `.sql` file. It writes the DDL the
  diagram's DDL tab shows (the CLI's `barwise export --format ddl`), and when a
  constraint has no SQL form, a warning offers a report naming each one.
- **As Avro Schemas**: pick a folder; it writes one `.avsc` per table, with
  the export's review notes in the schema docs.

OpenAPI and NORMA export are available only through `#barwiseExport` in chat.
Neither the palette nor the chat tool lets you choose a SQL dialect for DDL;
the CLI's `barwise export --dialect` does.

## 6. Change the model safely

These are chat tools; the palette has no equivalent.

- `#barwiseDiff` compares two models and grades each change as safe, caution
  or breaking.
- `#barwiseMerge` folds one model into another, taking additions and changes
  and refusing removals. It writes the result over the base model's file, so
  commit first. (The CLI's `barwise merge` does not touch its inputs.)
- `#barwiseRename` renames an object type, a fact type or a role, and given a
  project, follows it into the other domains and mapping files. It writes the
  files it changes, as the CLI's `barwise rename` does, and refuses a model
  with unsaved changes: save first.
- `#barwiseLineage` reports which exported artifacts are out of date, and
  `#barwiseImpact` lists the artifacts built from one element. Both read the
  lineage manifest that only the CLI's `barwise export` writes; exports made
  from the editor are not recorded, so these tools cannot see them.
- `#barwiseReview` asks the configured model for modeling advice.

The extension has no model-history view; use the CLI's `barwise history` for a
semantic git history of a model.

## 7. Grow into a multi-domain project

The extension checks a `.orm-project.yaml` manifest's structure as you edit.
The rules that span domains, such as a mapping that names a domain the
project does not have, run only in the CLI's `barwise validate`; `#barwiseValidate`
checks each domain on its own. In chat, `#barwiseSplit` splits the open model
into a project: it previews the assignment of entity types to contexts first
and writes the files only when asked to. Starting an empty project is the
CLI's `barwise project init`; see the
[project guide](../ORM_PROJECT_GUIDE.md). The chat tools that read a model,
such as `#barwiseValidate`, `#barwiseDescribe` and `#barwiseExport`, accept a
manifest and a domain name.

## 8. Use the extension's MCP server elsewhere

The extension also registers a barwise MCP server with VS Code, labeled
**Barwise ORM**, so other MCP clients running inside VS Code can call the same
tools. `barwise.enableMcpServer` turns off both this server and the chat tools.
For MCP clients outside VS Code, see the [MCP guide](mcp.md).

## 9. What the extension does not do

- The palette offers fewer import and export formats than the engine has;
  the rest need Copilot Chat.
- There is no modeling gym or history view, and splitting a project is a
  chat tool with no palette command.
- **Barwise: New Project** creates a model, not a project.

These and the differences from the other surfaces are listed, with tracker
issues, in [the surface parity audit](../surface-parity-audit-2026-10-12.md).

## Settings

| Setting                              | Default        | What it does                                                     |
| ------------------------------------ | -------------- | ---------------------------------------------------------------- |
| `barwise.llmProvider`                | `copilot`      | `copilot` or `anthropic`, for transcript import and review       |
| `barwise.copilotModelFamily`         | (empty)        | Preferred Copilot model family, such as `claude-sonnet`          |
| `barwise.anthropicModel`             | a Claude model | Anthropic model id, when the provider is `anthropic`             |
| `barwise.enableMcpServer`            | `true`         | Registers the chat tools and the MCP server                      |
| `barwise.showCounterexamplesOnHover` | `false`        | Shows what each constraint rules out on hover                    |
| `barwise.verboseLogging`             | `false`        | Logs prompt sizes, raw responses and latency to the output panel |
