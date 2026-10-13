# Getting started with the barwise MCP server

The MCP server gives an AI assistant the barwise tools: you describe what you
want in plain language, and the assistant calls the tools to import, check,
and export the model. Any client that speaks the Model Context Protocol over
stdio can use it, including Claude Code, Claude Desktop, Cursor and GitHub
Copilot. This guide follows the path in
[GETTING_STARTED.md](../../../GETTING_STARTED.md): install, start a model,
check it, generate artifacts, change it safely, and grow it into a project.
Each tool's parameters and return shape are in the
[MCP reference](../MCP.md).

The examples use the sample files in
[`examples/getting-started/`](../../examples/getting-started/). Each step
shows a request you can type to your assistant and the tool it should call.
The assistant chooses the calls; naming the tool in your request makes the
choice for it.

## 1. Install and connect

Download `barwise-mcp-<version>.cjs` from the
[releases page](https://github.com/semantic-praxis/barwise/releases) and note
its absolute path. (From a clone, `npm run build` produces
`barwise/packages/mcp/dist/index.js`, which works the same way.) The server
needs Node.js and nothing else.

Then register it with your client. The command is always `node` with the
file's absolute path.

**Claude Code**, for every project:

```sh
claude mcp add --scope user barwise -- node /path/to/barwise-mcp-<version>.cjs
```

or for one project, in a `.mcp.json` at the project root:

```json
{
  "mcpServers": {
    "barwise": {
      "command": "node",
      "args": ["/path/to/barwise-mcp-<version>.cjs"]
    }
  }
}
```

**Claude Desktop** and **Cursor** take the same `mcpServers` block, in
`claude_desktop_config.json` (Claude Desktop: Settings, Developer, Edit Config)
and in `.cursor/mcp.json` respectively.

**VS Code**: the barwise extension registers the server for you (see the
[VS Code guide](vscode.md)). Without the extension, add `.vscode/mcp.json`:

```json
{
  "servers": {
    "barwise": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/barwise-mcp-<version>.cjs"]
    }
  }
}
```

The packages are not on npm, so a configuration that runs
`npx @barwise/mcp` will not start.

To check the connection, ask the assistant: "List the barwise tools you have."
It should name the tools in the table at the end of this guide.

## 2. Configure a model provider (only for transcripts and review)

Two tools call a large language model: `import_transcript` and
`review_model`. The others are deterministic and need no key.

The server first tries to borrow your assistant's own model through MCP
sampling, which needs no key at all. It can do that only when the client
advertises sampling with tool support; the result of each call says which
route it took. Otherwise it falls back to the environment, in this order:

1. `ANTHROPIC_API_KEY` is set: Anthropic.
2. `OPENAI_API_KEY` is set: OpenAI.
3. Neither: Ollama on `http://localhost:11434`.

The server inherits the environment of the client that starts it, so set the
variable in the shell or session that launches your assistant. Do not write
the key into `.mcp.json` or another configuration file that may be committed.
A `fetch failed` error usually means no key was set and no Ollama server was
running.
The `provider` and `model` parameters override the choice per call.

## 3. Start a model

The tools take a model as a file path or as inline YAML (the `source`
parameter), and most return text rather than writing files. Ask the assistant
to save results where you want them.

### From nothing

There is no tool that creates an empty model. Ask the assistant to start from
the sample:

> Copy examples/getting-started/shop.orm.yaml to my-domain.orm.yaml and
> validate it.

An assistant can also write a model from scratch and pass it inline to
`validate_model` until it is clean, then save it.

### From an existing schema or codebase

`import_model` runs the deterministic importers: `ddl`, `sql`, `openapi`,
`norma`, `dbt`, `typescript`, `java` and `kotlin`. No LLM is involved.

> Import examples/getting-started/shop.sql as DDL with import_model and save
> the result as imported.orm.yaml.

`analyze_repository` profiles a GitHub repository or a local checkout and
runs the matching importer. Before cloning a repository it has not seen, it
returns `requiresConfirmation` and waits for the assistant to ask you.

An import is a starting point. Have the assistant verbalize it (step 4) and
rewrite the readings no one would say out loud: the DDL importer, for one,
names a foreign-key fact type after the column.

### From a conversation

`import_transcript` extracts a model from meeting notes or a transcript:

> Extract an ORM model from examples/transcripts/order-management.md with
> import_transcript and save it as orders.orm.yaml.

Pass `base` (an existing model) and the extraction reuses the object types
that model already has instead of inventing new ones; it still returns a new
model rather than merging. `samples` runs the extraction several times and
reports where the runs disagree; `alternatives` adds one other way to frame
the model. The `analyze-domain` prompt walks the assistant through the same
job.

## 4. Check the model

- `validate_model` returns the structural errors and warnings as JSON.
- `verbalize_model` reads every fact type and constraint back as plain
  sentences. This is the step that catches modeling mistakes: read them, or
  show them to someone who knows the business, and ask whether each is true.
  `counterexamples: true` adds the smallest sample of data each constraint
  rules out.
- `query_model` answers one precise question ("path Customer OrderStatus",
  "constraints-of SalesOrder"); `describe_domain` summarizes an entity and its
  rules.
- `generate_diagram` returns an SVG.

> Validate shop.orm.yaml, then verbalize it and tell me which sentences a
> business user might disagree with.

When a result is too large to return inline (8 KB by default), the tool
writes it to `.barwise/mcp-cache/` beside the model and returns the path and
a preview. Diagrams usually take this route.

The `review-model` prompt runs validate, verbalize and the schema check in
sequence.

## 5. Generate artifacts

`export_model` produces every export format the engine has: `ddl`, `dbt`,
`openapi`, `avro` and `norma`. `outputPath` chooses where a large artifact is
written. `options` carries `annotate`, `includeExamples` and `strict`, plus
format-specific settings such as `dialect` for DDL.

> Export shop.orm.yaml as Snowflake DDL with export_model and write it to
> out/shop.sql.

`generate_schema` is the older, DDL-or-JSON-only path to the same relational
mapping.

## 6. Change the model safely

- `diff_models` compares two models and grades each change as safe, caution
  or breaking.
- `merge_models` folds one model into another, taking additions and changes
  and refusing removals. **When the base is a file path and the merge is
  valid, it writes the merged model over that file.** Commit first, or pass
  the base as inline YAML. The CLI's `barwise merge` behaves differently: it never
  changes its inputs.
- `lineage_status` lists exported artifacts that are out of date with the
  model. It reads the lineage manifest that only the CLI's `barwise export`
  writes; artifacts exported with `export_model` are not recorded, so the
  lineage tools cannot see them.
- `impact_analysis` lists the artifacts built from one element. It takes the
  element's `id`, not its name; a name returns an empty list whether or not
  anything depends on it.
- `review_model` asks the configured model for modeling advice.

## 7. Grow into a multi-domain project

`validate_model`, `verbalize_model`, `describe_domain`, `query_model`,
`export_model` and `review_model` accept a `.orm-project.yaml` manifest as the
`source`, with an optional `domain` to pick one context.

`split_model` cuts one model into a project, the same split as
`barwise project split`. Call it first without `outDir` to preview the
assignment of entity types to contexts; nothing is written. Call it again with
`outDir` to write the manifest, domain files and mappings:

> List the entity types in big.orm.yaml, then preview splitting it into sales
> and billing with split_model. Write it to ./project once I agree.

Two limits remain. Starting an empty project is the CLI's
`barwise project init`, and `validate_model` checks each domain on its own,
without the rules that span domains that `barwise validate` runs. The
[project guide](../ORM_PROJECT_GUIDE.md) covers the whole workflow.

## 8. Resources and prompts

Besides tools, the server offers:

- `orm-schema://json-schema`: the JSON Schema for `.orm.yaml` files.
- `orm-model://{path}`: a model file, parsed, as JSON.
- `reasoning-trail://{path}`: the reasoning trail for a model, from its
  `.trail.json` sidecar when the CLI wrote one at import, or else computed from
  the model.
- The `analyze-domain` and `review-model` prompts, described above.

## 9. What the MCP server does not do

- There is no tool to create an empty model or project, or to show git
  history.
- The modeling gym tools (`gym_list`, `gym_check`) work from a source build
  but not yet from the downloaded `.cjs` file, which cannot find the exercise
  catalog.
- `merge_models` writes to its base file, unlike the CLI.
- `export_model` does not record lineage, so `lineage_status` and
  `impact_analysis` see only artifacts the CLI exported.

These and the differences from the other surfaces are listed, with tracker
issues, in [the surface parity audit](../surface-parity-audit-2026-10-12.md).

## The tools

| Tool                 | What it does                                             |
| -------------------- | -------------------------------------------------------- |
| `import_model`       | Imports DDL, SQL, OpenAPI, NORMA, dbt or code (no LLM)   |
| `import_transcript`  | Extracts a model from a transcript (LLM)                 |
| `analyze_repository` | Profiles a repository and imports it                     |
| `validate_model`     | Checks the structural rules                              |
| `verbalize_model`    | Reads the model back as sentences                        |
| `query_model`        | Answers one structural question                          |
| `describe_domain`    | Summarizes entities, fact types and constraints          |
| `generate_diagram`   | Draws the diagram as SVG                                 |
| `generate_schema`    | Maps the model to tables (DDL or JSON)                   |
| `export_model`       | Exports DDL, dbt, OpenAPI, Avro or NORMA                 |
| `diff_models`        | Compares two models                                      |
| `merge_models`       | Merges one model into another (writes the base file)     |
| `split_model`        | Previews or writes a multi-domain project from one model |
| `lineage_status`     | Lists stale exported artifacts                           |
| `impact_analysis`    | Lists the artifacts built from one element               |
| `review_model`       | Gives modeling advice (LLM)                              |
| `gym_list`           | Lists the modeling-gym exercises                         |
| `gym_check`          | Grades a model against an exercise                       |
