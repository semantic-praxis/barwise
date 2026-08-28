# Barwise CLI

Command-line tool for ORM 2 modeling. Wraps the platform-independent
packages (`@barwise/core`, `@barwise/diagram`, `@barwise/llm`) into a
`barwise` binary.

## Installation

From the monorepo root:

```sh
npm run build
npm link --workspace=packages/cli
```

Or run directly without linking:

```sh
node packages/cli/dist/index.js <command>
```

## Commands

### validate

Run the validation engine on a model file and report diagnostics.

```sh
barwise validate model.orm.yaml
barwise validate model.orm.yaml --format json
barwise validate model.orm.yaml --no-warnings
barwise validate project.orm-project.yaml
```

Options:

- `--format <text|json>` -- output format (default: text)
- `--no-warnings` -- suppress warnings, show errors only

Given a `.orm-project.yaml` manifest, every domain model is validated
and the cross-domain project rules are run; diagnostics are prefixed
with their context. See [ORM_PROJECT_GUIDE.md](ORM_PROJECT_GUIDE.md).

Exit code 1 if there are validation errors.

### verbalize

Generate FORML natural-language readings for fact types and constraints.

```sh
barwise verbalize university.orm.yaml
barwise verbalize university.orm.yaml --fact-type "Student enrolls in Course"
barwise verbalize university.orm.yaml --format json
```

Options:

- `--format <text|json>` -- output format (default: text)
- `--fact-type <name>` -- verbalize a specific fact type only

### describe

Describe a model's domain context: entities, fact types, constraints,
and populations, as a summary or in full detail.

```sh
barwise describe university.orm.yaml
barwise describe university.orm.yaml --verbose
barwise describe university.orm.yaml --focus Student
barwise describe project.orm-project.yaml --domain catalog --json
```

Options:

- `--focus <name>` -- focus on a specific entity, fact type, or
  constraint type
- `--verbose` -- show full detail (all entities, fact types,
  constraints, populations) instead of the summary
- `--json` -- output as JSON instead of human-readable text
- `--domain <context>` -- for a project, describe only this one domain

Given a `.orm-project.yaml` manifest, every domain is described in
turn, each under a `== context ==` header (or as an array in JSON).

### schema

Generate a relational schema from the ORM model.

```sh
barwise schema university.orm.yaml
barwise schema university.orm.yaml --format json
barwise schema university.orm.yaml --output schema.sql
```

Options:

- `--format <ddl|json>` -- DDL SQL or JSON mapping (default: ddl)
- `--output <file>` -- write to file instead of stdout

### export

Export a model in any registered format. The target format is selected
with the required `--format` option.

```sh
barwise export model.orm.yaml --format ddl
barwise export model.orm.yaml --format ddl --output schema.sql
barwise export model.orm.yaml --format dbt --output dbt_project/
barwise export model.orm.yaml --format openapi --strict --no-annotate
```

Formats:

- `ddl` -- relational schema as SQL DDL
- `openapi` -- OpenAPI 3.0 specification
- `dbt` -- dbt model YAML and SQL files
- `avro` -- Avro schemas (`.avsc`)

Options:

- `--format <name>` -- export format (required)
- `--output <path>` -- write to a file, or to a directory for
  multi-file formats like `dbt`; defaults to stdout
- `--no-annotate` -- exclude TODO/NOTE annotations
- `--strict` -- fail on validation errors
- `--no-examples` -- exclude population example data

### diagram

Generate an SVG diagram from the model.

```sh
barwise diagram university.orm.yaml
barwise diagram university.orm.yaml --output university.svg
barwise diagram project.orm-project.yaml --output diagrams/
barwise diagram project.orm-project.yaml --domain catalog --output catalog.svg
```

Options:

- `--output <path>` -- write SVG to a file (model) or directory (project)
- `--domain <context>` -- for a project, diagram only this one domain

Given a `.orm-project.yaml` manifest, `diagram` writes one SVG per
domain into the `--output` directory. With `--domain`, it instead
renders just the named domain as a single SVG.

### diff

Compare two ORM model files and report structural deltas.

```sh
barwise diff old.orm.yaml new.orm.yaml
barwise diff old.orm.yaml new.orm.yaml --format json
barwise diff old.orm.yaml new.orm.yaml --no-synonyms
```

Options:

- `--format <text|json>` -- output format (default: text)
- `--no-synonyms` -- hide synonym/rename candidates

### merge

Merge an incoming model into a base model: the sibling of `diff`, the
same comparison read in the other direction.

```sh
barwise merge base.orm.yaml incoming.orm.yaml
barwise merge base.orm.yaml incoming.orm.yaml --output merged.orm.yaml
barwise merge base.orm.yaml incoming.orm.yaml --format json
```

The merge is non-interactive: additions and modifications are accepted,
removals are rejected. A removal you meant is a deliberate edit, not
something a merge should infer.

Neither input file is modified. The merged model goes to stdout unless
`--output` names a file. If the merge produces structural errors,
nothing is written anywhere and the command exits 1 -- a broken model
on disk is worse than no model.

Options:

- `--output <file>` -- write the merged model to a file instead of stdout
- `--format <yaml|json>` -- output format (default: yaml)

### review

Review a model's semantic quality using an LLM. Distinct from
`validate`, which checks structural rules deterministically: review
returns advice, and advice can be wrong.

```sh
barwise review model.orm.yaml
barwise review model.orm.yaml --focus Customer
barwise review model.orm.yaml --format json
```

Requires an LLM provider, configured the same way as
`import transcript` (see below).

`review` always exits 0 when the review completes, whatever it says. It
is deliberately not a CI gate: failing a build on model-generated
suggestions would put an LLM in your merge path, where a bad day for
the provider becomes a red build for everyone. To gate on review
output, pipe `--format json` through `jq` and decide your own policy.

Options:

- `--focus <name>` -- review only this entity or fact type
- `--provider <anthropic|openai|ollama>` -- auto-detects from env vars if omitted
- `--model <model>` -- model override for the provider
- `--api-key <key>` -- falls back to env vars
- `--base-url <url>` -- Ollama server URL
- `--format <text|json>` -- output format (default: text)

### gym

The modeling gym: practice exercises with deterministic feedback. Three
subcommands: `list`, `show`, and `check`.

```sh
barwise gym list
barwise gym show customer-order
barwise gym check customer-order my-model.orm.yaml
barwise gym check customer-order my-model.orm.yaml --emit-misses deck.txt
```

`gym list` lists the packaged exercises with their skill transitions.
`gym show <id>` prints an exercise's brief, reading, and starter model
path. `gym check <id> <candidate>` evaluates a candidate model against
the exercise's rubric: the evaluator is deterministic, and a failed
check emits miss cards in the Anki deck import format plus a hint and a
suggested next step.

Options:

- `--format <text|json>` -- output format for `list` and `check`
  (default: text)
- `--catalog <dir>` -- load exercises from this directory instead of
  the packaged catalog
- `--emit-misses <file>` -- (`check` only) also write the miss-card
  deck file to this path
- `--no-state` -- (`check` only) skip the session log and miss-card
  copy in the state directory

By default `check` appends a session-log line and, on failure, a
miss-card copy under the learner's state directory
(`$XDG_STATE_HOME/barwise/`, fallback `~/.local/state/barwise/`).

`check` exits 1 when any rubric check fails.

### history

Show a model's semantic change history from git: the file's revisions
are walked newest first, and each adjacent pair is rendered as semantic
deltas via the diff engine rather than as text hunks.

```sh
barwise history model.orm.yaml
barwise history model.orm.yaml --limit 5
```

Options:

- `--limit <n>` -- walk only the newest n revisions (default: 20)

Renames are followed. When the file on disk differs from HEAD, an
extra `working tree (uncommitted)` section leads the output. A
revision that predates the current schema is reported as unreadable
rather than failing the walk. A file with no git history exits 1.

### project

Scaffold and manage multi-domain projects. A project ties several
`.orm.yaml` domain models together through a `.orm-project.yaml`
manifest and `.map.yaml` context mappings. For the full workflow, see
[ORM_PROJECT_GUIDE.md](ORM_PROJECT_GUIDE.md).

`project init` creates an empty project with the standard layout:

```sh
barwise project init "Sales Warehouse"
barwise project init "Sales Warehouse" --dir ./warehouse
```

`project split` cuts a monolithic model into one file per bounded
context, plus suggested context mappings for any object type shared
across a seam:

```sh
# Generate a starter config listing every object type.
barwise project split model.orm.yaml --scaffold-config \
  --domains catalog,auctions,payments,parties > split.yaml

# Edit split.yaml, then run the split.
barwise project split model.orm.yaml --config split.yaml --out ./project
```

Options:

- `--config <path>` -- split config YAML (`projectName` and a
  `domains` map of context to object type names)
- `--out <dir>` -- directory to write the project into (default: `.`)
- `--scaffold-config` -- print a starter config instead of splitting
- `--domains <list>` -- comma-separated contexts (with `--scaffold-config`)
- `--force` -- overwrite an existing manifest

Object types not listed in the config are given a home by inference
from the fact types that use them. The split reports every inferred
home, dropped cross-domain constraint, and generated mapping as a
warning to review.

### import model

Import an ORM model from a text-based interop format.

```sh
barwise import model schema.sql --format ddl
barwise import model api.yaml --format openapi --output model.orm.yaml
```

Options:

- `--format <ddl|openapi|norma>` -- source format (required)
- `--output <file>` -- write .orm.yaml to file instead of stdout
- `--name <name>` -- model name (defaults to filename)

The import summary (element counts, confidence, warnings) goes to
stderr, keeping stdout a clean pipe for the YAML.

### import norma

Import an ORM model from a NORMA `.orm` XML file. A shortcut for
`import model --format norma`.

```sh
barwise import norma legacy.orm --output model.orm.yaml
```

Options:

- `--output <file>` -- write .orm.yaml to file instead of stdout
- `--name <name>` -- model name (defaults to filename)

### import dbt

Import an ORM model from a dbt project directory.

```sh
barwise import dbt ./dbt_project --output model.orm.yaml
```

Options:

- `--output <file>` -- write .orm.yaml to file instead of stdout
- `--name <name>` -- model name (defaults to directory name)

The SQL dialect is detected from the `DBT_TARGET_TYPE` (or
`DBT_ADAPTER`) environment variable and the dbt profiles in the home
directory.

### import sql

Import an ORM model from raw SQL files: a single file or a directory
of `.sql` files.

```sh
barwise import sql schema.sql
barwise import sql ./migrations --dialect postgres --output model.orm.yaml
```

Options:

- `--output <file>` -- write .orm.yaml to file instead of stdout
- `--name <name>` -- model name (defaults to filename/dirname)
- `--dialect <dialect>` -- SQL dialect: `ansi`, `snowflake`,
  `bigquery`, `postgres`, `mysql`, `redshift`, or `databricks`

### import typescript / java / kotlin

Import an ORM model from a code project directory. The importer runs a
language server over the project to extract types deterministically --
no LLM involved.

```sh
barwise import typescript ./my-app --output model.orm.yaml
barwise import java ./service --lsp-command jdtls
barwise import kotlin ./service
```

Options:

- `--output <file>` -- write .orm.yaml to file instead of stdout
- `--name <name>` -- model name (defaults to directory name)
- `--lsp-command <cmd>` -- custom LSP command (e.g.
  `typescript-language-server --stdio`, `jdtls`,
  `kotlin-language-server`)

### import transcript

Extract an ORM model from a transcript using an LLM provider.

```sh
barwise import transcript meeting-notes.md --output model.orm.yaml
barwise import transcript notes.txt --provider openai --model gpt-4o
barwise import transcript notes.txt --provider ollama --base-url http://localhost:11434
```

Options:

- `--output <file>` -- write .orm.yaml to file instead of stdout
- `--provider <anthropic|openai|ollama>` -- LLM provider (auto-detects
  from env vars if omitted)
- `--model <name>` -- model override for the LLM provider
- `--api-key <key>` -- API key (falls back to env vars)
- `--base-url <url>` -- Ollama server URL (ollama provider only)
- `--name <name>` -- model name (defaults to filename)
- `--no-annotate` -- skip TODO/NOTE annotations in output

Provider auto-detection checks environment variables in order:

1. `ANTHROPIC_API_KEY` set -- uses Anthropic (Claude)
2. `OPENAI_API_KEY` set -- uses OpenAI
3. Neither set -- uses Ollama (local, no key required)

When `--output` targets an existing `.orm.yaml` file, the command runs
a non-interactive merge: additions and modifications are accepted,
removals are rejected. Use `barwise diff` to review changes first.

### import batch

Run every `.md` transcript in a directory through one or more LLM
models -- one output file per transcript-model combination, named
`<transcript>-<model-slug>.orm.yaml`.

```sh
barwise import batch ./transcripts --model claude-haiku-4-5
barwise import batch ./transcripts --model gpt-4o --model claude-haiku-4-5 \
  --output-dir ./results
```

Options:

- `--model <models...>` -- LLM model names to use, repeatable (required)
- `--provider <anthropic|openai|ollama>` -- auto-detects from env vars
  if omitted
- `--api-key <key>` -- falls back to env vars
- `--base-url <url>` -- Ollama server URL
- `--no-annotate` -- skip TODO/NOTE annotations in output
- `--output-dir <dir>` -- write outputs to a different directory
  (defaults to the input directory)

A summary table of element counts per combination is printed at the
end. Exit code 1 if any combination fails; the rest still run.

### analyze

Analyze a repository to extract business rules and constraints: profile
it, pick the detected deterministic importer, and write the extracted
model.

```sh
barwise analyze MyOrg/MyRepo --profile-only
barwise analyze MyOrg/MyRepo --ref v2.0.0 --output model.orm.yaml
barwise analyze ./local-checkout --domain billing
```

The argument is a GitHub repository (`owner/name`, cloned via the
authenticated GitHub CLI) or a local directory, which is analyzed in
place with no clone and no auth. Without `--profile-only`, the detected
code importer runs over the detected domain scope and the model goes to
stdout or `--output`. A repository with no detectable deterministic
import format is an error -- use `barwise import transcript` with an
LLM provider instead.

Options:

- `--profile-only` -- show the repository profile (language, framework,
  build system, domain paths) without running the full analysis
- `--ref <ref>` -- branch, tag, or commit to analyze
- `--depth <depth>` -- clone depth, 0 for a full clone (default: 1)
- `--domain <name>` -- model name for the extracted domain
- `--output <file>` -- write the extracted .orm.yaml here (default:
  stdout)
- `--format <text|json>` -- profile output format (default: text)

### lineage

Lineage tracking and staleness detection over the manifest that
`barwise export` maintains beside the model. Three subcommands:
`status`, `impact`, and `show`.

```sh
barwise lineage status model.orm.yaml
barwise lineage impact model.orm.yaml --element "Customer"
barwise lineage show model.orm.yaml --format json
```

`lineage status` compares the current model against the manifest and
lists stale and fresh artifacts. `lineage impact` reports which
exported artifacts depend on a model element -- the impact analysis in
the capability matrix. `lineage show` prints the manifest itself.

Options:

- `--element <id>` -- (`impact` only) element ID to analyze (required)
- `--format <text|json>` -- output format (default: text)

With no manifest present, `status` and `show` say so and point at
`barwise export`. `status` exits 1 when any artifact is stale, which
makes it usable as a CI gate.

### query

Run a deterministic symbolic query against an ORM model. Answers precise
structural questions -- what entities exist, what fact types an entity
participates in, what constraints apply, how two entities connect --
without any LLM inference.

```sh
barwise query model.orm.yaml entities
barwise query model.orm.yaml entity Customer
barwise query model.orm.yaml fact-type "Customer places Order"
barwise query model.orm.yaml fact-types-of Customer
barwise query model.orm.yaml constraints-of Order
barwise query model.orm.yaml subtypes-of Person transitive
barwise query model.orm.yaml path Customer Product
barwise query model.orm.yaml stats --json
```

The query is one line: a command keyword followed by arguments. Names
containing spaces are double-quoted (the shell may quote them for you).

Commands:

| Command                               | Answers                                       |
| ------------------------------------- | --------------------------------------------- |
| `entities [entity\|value]`            | All object types, optionally filtered by kind |
| `fact-types [<arity>]`                | All fact types, optionally filtered by arity  |
| `constraints [<type>]`                | All constraints, optionally filtered by type  |
| `entity <name>`                       | Full detail for one entity                    |
| `fact-type <name>`                    | Full detail for one fact type                 |
| `fact-types-of <entity>`              | Fact types an entity participates in          |
| `related-to <entity>`                 | Entities sharing a fact type with the entity  |
| `constraints-of <name>`               | Constraints touching an entity or fact type   |
| `subtypes-of <entity> [transitive]`   | Direct (or transitive) subtypes               |
| `supertypes-of <entity> [transitive]` | Direct (or transitive) supertypes             |
| `mandatory-roles [<entity>]`          | Mandatory roles, optionally for one entity    |
| `path <entityA> <entityB>`            | Shortest fact-type path between two entities  |
| `stats`                               | Element counts for the model                  |

Options:

- `--json` -- output the structured `QueryResult` as JSON instead of
  human-readable text

A malformed query exits with code 1; a well-formed query against a
missing element prints a "not found" message and exits 0.

### prompt

Prompt evaluation for the LLM surfaces: dev tooling over the eval
suite, the score history, and the shipped prompt artifacts. Six
subcommands: `eval`, `score`, `schema`, `artifact`, `run`, `history`.

```sh
barwise prompt eval --split dev --repeat 3
barwise prompt score --case enrollment-1 --extraction payload.json
barwise prompt schema --surface review
barwise prompt artifact --provider anthropic --model claude-haiku-4-5
barwise prompt run notes.md --artifacts ./candidates
barwise prompt history --format json
```

- `eval` -- run the eval suite against a live provider and record the
  scores. Options: `--suite <manifest>`, `--provider`, `--model`,
  `--api-key`, `--base-url`, `--artifacts <dir>`,
  `--artifact-version <version|default>`, `--repeat <n>`
  (default: 1), `--split <train|dev>`, `--max-tokens <n>`,
  `--save-payloads <dir>`, `--context-window <n>` (ollama only),
  `--format <text|json>`, `--verbose`, `--no-history`,
  `--force-history`.
- `score` -- score one saved extraction payload against an eval case
  (the DSPy optimizer lane's metric entry point). Options: `--case
  <id>` (required), `--extraction <file>` (required), `--suite
  <manifest>`.
- `schema` -- print the structured-output JSON Schema for a surface.
  Options: `--surface <extraction|review>` (default: extraction).
- `artifact` -- print the prompt artifact a given target would actually
  resolve, offline, no API key needed. Options: `--surface`,
  `--provider`, `--model`, `--artifacts <dir>`,
  `--artifact-version <version|default>`, `--format
  <text|json>`. It says on stderr whether a variant matched, the
  default fell through, or a version was forced, and prints the
  version and prompt hash so a call-log row can be joined back to a
  readable prompt.
- `run` -- send a prompt artifact once against a live model and print
  the raw answer, unshipped candidates included. Options: `--surface`,
  `--artifacts <dir>`, `--provider`, `--model`, `--api-key`,
  `--base-url`. Takes a transcript file for extraction or a
  `.orm.yaml` for review.
- `history` -- show the suite's recorded eval scores. Options:
  `--suite <manifest>`, `--format <text|json>`.

`--artifacts <dir>` loads unshipped `.prompt.yaml` candidates and is
deliberately confined to this lane: `eval`, `artifact`, and `run`
accept it; the production commands (`import transcript`, `review`) do
not and must not. Production resolves over the built-in artifacts
alone, which is what keeps every recorded `promptHash` recoverable --
trying a candidate against a live model is what `prompt run` is for
(see `docs/specs/artifact-resolution-parity.spec.md`).

`--artifact-version` (on `eval` and `artifact`) selects within that
candidate set by name instead of by provider/model match, and
`default` names the surface's default prompt -- so a
default-versus-variant comparison can hold the model fixed, which
previously required shadowing the builtins with match-less copies
(barwise-882). An unknown version fails before any call, naming the
versions that exist.

### llm-usage

Summarise the LLM call log: calls, tokens, latency percentiles, and
(given rates) cost, grouped by the model that actually answered.

```sh
barwise llm-usage
barwise llm-usage --rates rates.json
barwise llm-usage --log calls.jsonl --format json
```

Options:

- `--log <file>` -- call log to read (defaults to the configured path)
- `--rates <file>` -- JSON of per-model rates per million tokens, e.g.
  `{"claude-haiku-4-5": {"input": 1, "output": 5}}`
- `--format <text|json>` -- output format (default: text)

Recording is opt-in via `BARWISE_CALL_LOG`: unset is off, `1`/`true`
writes `$XDG_STATE_HOME/barwise/calls.jsonl`, any other value is used
as the path. With no log configured or none written yet, the command
says so and exits 0. No rates ship with barwise -- a stale price
produces a confidently wrong number, which is worse than none -- so
cost appears only when `--rates` is passed.
