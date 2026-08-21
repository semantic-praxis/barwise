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
