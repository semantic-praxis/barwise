# Getting started with the barwise CLI

The CLI is barwise from a terminal: every capability is a command, every
command reads and writes files, and the exit codes are meant for CI. This
guide follows the path in [GETTING_STARTED.md](../../../GETTING_STARTED.md):
install, start a model, check it, generate artifacts, change it safely, and
grow it into a project. Every option of every command is in the
[CLI reference](../CLI.md).

The examples use the sample files in
[`examples/getting-started/`](../../examples/getting-started/). Copy them into
an empty directory and run the commands from there.

## 1. Install and check

Download `barwise-cli-<version>.cjs` from the
[releases page](https://github.com/semantic-praxis/barwise/releases) and give
it a short name:

```sh
alias barwise="node /path/to/barwise-cli-<version>.cjs"
barwise --version
```

From the root of a clone of the repository, build once and link the binary
instead:

```sh
cd barwise
npm install && npm run build
npm link --workspace=packages/cli
barwise --version
```

The rest of this guide writes `barwise`; either install works.

## 2. Configure a model provider (only for transcripts and review)

Two commands call a large language model: `barwise import transcript` and
`barwise review`. Everything else is deterministic and needs no key.

The provider is picked from the environment:

1. `ANTHROPIC_API_KEY` is set: Anthropic.
2. `OPENAI_API_KEY` is set: OpenAI.
3. Neither: Ollama on `http://localhost:11434`.

`--provider` and `--model` override the choice. Keys are read only from the
environment; the CLI refuses `--api-key`, because a key on the command line
ends up in shell history and CI logs. If an LLM command fails with
`fetch failed`, the usual cause is that no key was set and no Ollama server
was running.

## 3. Start a model

There are three ways in. Whichever you use, the result is a `.orm.yaml` file
that you then check and refine.

### From nothing

The CLI has no command that writes an empty model. Start from the sample
instead:

```sh
cp shop.orm.yaml my-domain.orm.yaml
```

The file has three parts: `object_types` (the things in the domain, such as
`Customer`, and the values that describe them, such as `CustomerNumber`),
`fact_types` (sentences that relate them, such as "Customer places
SalesOrder"), and the `constraints` on each fact type (such as "each
SalesOrder is placed by exactly one Customer"). Element `id`s only have to be
unique within the file; importers generate UUIDs, and readable ids like the
sample's are fine in a file you write by hand.

### From an existing schema or codebase

The deterministic importers read what you already have and produce a draft
model. No LLM is involved.

```sh
barwise import model shop.sql --format ddl --output imported.orm.yaml
```

The same family covers the other sources:

```sh
barwise import sql ./migrations --dialect snowflake --output warehouse.orm.yaml
barwise import dbt ./my_dbt_project --output dbt.orm.yaml
barwise import norma legacy.orm --output legacy.orm.yaml
barwise import typescript ./my-app --output app.orm.yaml
barwise analyze ./local-checkout --profile-only
```

An import is a starting point, not a finished model. Run `barwise verbalize`
on it (step 4) and you will find readings no one would say out loud: the DDL
importer names a foreign-key fact type after the column, so `shop.sql`
produces "SalesOrder customerNumber Customer" where you mean "Customer places
SalesOrder". Rewriting those readings, and adding the definitions the
validator asks for, is the modeling work.

`--output` overwrites an existing file. Re-importing onto a model you have
edited replaces your edits; import to a new file and use `barwise merge`
(step 6) instead.

### From a conversation

`barwise import transcript` sends a meeting transcript or requirements notes
to the configured model provider and writes the model it extracts, with
`# TODO` comments where the extraction was unsure:

```sh
barwise import transcript order-management.md --output orders.orm.yaml
```

To try it, copy `order-management.md` from
[`examples/transcripts/`](../../examples/transcripts/), which holds several
sample transcripts. Unlike the other importers, a transcript import onto an
existing file merges into it: additions and changes are accepted and removals
are not.

## 4. Check the model

`validate` checks the structural rules. It exits 1 when there are errors, so
it works as a CI gate:

```sh
barwise validate shop.orm.yaml
```

```
shop.orm.yaml: valid (0 errors, 0 warnings)
```

`verbalize` reads every fact type and constraint back as plain sentences. This
is the step that catches modeling mistakes: show the output to someone who
knows the business and ask whether each sentence is true.

```sh
barwise verbalize shop.orm.yaml --fact-type "Customer places SalesOrder"
```

```
Customer places SalesOrder
SalesOrder is placed by Customer
  Each SalesOrder is placed by at most one Customer.
  Each SalesOrder is placed by at least one Customer.
```

Add `--counterexamples` to see, for each constraint, the smallest sample of
data it rules out.

`query` and `describe` answer questions about the model without reading the
YAML:

```sh
barwise query shop.orm.yaml constraints-of SalesOrder
barwise query shop.orm.yaml path Customer OrderStatus
barwise describe shop.orm.yaml --focus SalesOrder
```

`diagram` writes an SVG:

```sh
barwise diagram shop.orm.yaml --output shop.svg
```

It prints a note saying the command is deprecated in favor of
`barwise export --format svg`. That format does not exist yet, so keep using
`diagram`.

## 5. Generate artifacts

`export` turns the model into the artifacts a data team builds. Pick the
format with `--format`:

```sh
barwise export shop.orm.yaml --format ddl --dialect snowflake --output out/shop.sql
barwise export shop.orm.yaml --format dbt --output out/dbt
barwise export shop.orm.yaml --format openapi --output out/shop.openapi.json
barwise export shop.orm.yaml --format avro --output out/avro
barwise export shop.orm.yaml --format norma --output out/shop.orm
```

By default the output carries `TODO(barwise)` and `NOTE(barwise)` comments
where the model is missing something an engineer will need, such as a data
type or a column description. `--no-annotate` leaves them out; `--strict`
refuses to export a model that has validation errors.

Each export also records which model elements the artifact came from, in a
lineage manifest beside the model (`.barwise/lineage.yaml`). Step 6 uses it.

## 6. Change the model safely

`diff` compares two versions of a model and grades each change as `safe`,
`caution` or `breaking`:

```sh
barwise diff shop.orm.yaml imported.orm.yaml
```

`merge` folds one model into another: additions and modifications are taken,
removals are not. It never modifies either input; the result goes to stdout or
to `--output`:

```sh
barwise merge shop.orm.yaml imported.orm.yaml --output merged.orm.yaml
```

`history` walks the model's git history and shows each commit as model
changes rather than text changes:

```sh
barwise history shop.orm.yaml --limit 5
```

`lineage status` reports which exported artifacts are out of date with the
model, and exits 1 when any are stale. `lineage impact` lists the artifacts
built from one element. It takes the element's `id` from the YAML, not its
name; a name currently reports "No artifacts depend on this element" whether
or not that is true.

```sh
barwise lineage status shop.orm.yaml
barwise lineage impact shop.orm.yaml --element sales-order
```

`review` asks the configured LLM for modeling advice: naming, missing
constraints, definitions. It always exits 0, so it never fails a build on
advice that could be wrong:

```sh
barwise review shop.orm.yaml --focus SalesOrder
```

## 7. Grow into a multi-domain project

When one file covers several teams' vocabularies, split it into a project: a
`.orm-project.yaml` manifest, one model per bounded context, and mapping files
between them.

```sh
barwise project init "Order Management"
barwise project split big.orm.yaml --scaffold-config --domains sales,billing > split.yaml
barwise project split big.orm.yaml --config split.yaml --out ./project
```

The scaffolded `split.yaml` lists every entity type under the first context;
move each one under the context that owns it before running the split. The
split reports every inference it made as a warning to review.

Most read commands accept the manifest in place of a model, and `--domain`
selects one context:

```sh
barwise validate ./project/project.orm-project.yaml
barwise export ./project/project.orm-project.yaml --format ddl --domain sales
```

`project init` writes an empty manifest only. The
[project guide](../ORM_PROJECT_GUIDE.md) walks through a full split.

## 8. Use it in CI

The commands that can fail a build do so deliberately:

| Command                   | Exits 1 when                                 |
| ------------------------- | -------------------------------------------- |
| `barwise validate`        | the model has structural errors              |
| `barwise lineage status`  | an exported artifact is older than the model |
| `barwise export --strict` | the model has validation errors              |
| `barwise gym check`       | an exercise check fails                      |

`barwise review` is deliberately absent: it always exits 0.

## 9. What the CLI does not do

- There is no command that writes a starter model; copy the sample.
- The modeling gym (`barwise gym list`) works from a source build but not yet
  from the downloaded `.cjs` file, which cannot find the exercise catalog.
- Re-importing onto an existing file overwrites it for every importer except
  transcripts.

These and the differences from the other surfaces are listed, with tracker
issues, in [the surface parity audit](../surface-parity-audit-2026-10-12.md).
