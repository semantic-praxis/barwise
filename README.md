# barwise

Object-role modeling for data engineers and architects. Transform business concepts into precise, fact-oriented schemas that everyone can understand.

Barwise is an [ORM 2](https://en.wikipedia.org/wiki/Object-role_modeling) modeling toolkit. It ships as a VS Code extension, a `barwise` CLI, and an MCP server, all backed by the same platform-independent `@barwise/core` library, so all model logic is testable without launching an editor.

**New here? Start with [GETTING_STARTED.md](GETTING_STARTED.md)**, which walks the same workflow on each of the three surfaces.

## Learning ORM

Barwise assumes you know, or are willing to learn, some Object-Role Modeling. If you have modeled in ER or relational schemas, start with [the order-fulfillment tutorial](barwise/docs/tutorial/order-fulfillment.md). It builds one model step by step, and each step starts from bad data the model so far still allows. It is written for readers whose ER habits will mislead them in the early steps. The modeling gym (`barwise gym list`, from a source build) has short exercises with deterministic feedback.

### Why it is worth learning

Take one rule from a shop: every order is either shipped to an address or collected at a store. Never both, and never neither.

**In SQL DDL** the rule takes two nullable columns plus a `CHECK` that someone has to remember to write:

```sql
CREATE TABLE store (
  store_code   VARCHAR(10) NOT NULL PRIMARY KEY
);

CREATE TABLE sales_order (
  order_number INTEGER     NOT NULL PRIMARY KEY,
  address      VARCHAR(200),
  store_code   VARCHAR(10) REFERENCES store (store_code),
  CHECK ((address IS NOT NULL AND store_code IS NULL)
      OR (address IS NULL AND store_code IS NOT NULL))
);
```

Leave out the `CHECK` and the table still builds, and it now accepts an order with neither a delivery address nor a store. Nothing in the columns themselves says they are related.

**In an ER diagram** the rule is two optional relationships from Order. The crow's-foot notation most tools draw has no mark for "exactly one of these," so the rule ends up in a note. Barker notation's exclusive arc is the exception.

**In ORM** the rule is a constraint across the two fact types, an exclusive-or, and barwise reads it back as a sentence the shop manager can check:

> Each SalesOrder either is shipped to some Address or is collected from some Store but not both.

The model is [`barwise/examples/models/order-handover.orm.yaml`](barwise/examples/models/order-handover.orm.yaml). Run `barwise verbalize examples/models/order-handover.orm.yaml` from `barwise/` to get that sentence. The rule is written once, in the model, in a form the business can confirm, rather than depending on whoever writes the DDL to remember a `CHECK`. One current limitation: barwise's DDL export does not yet generate that `CHECK`. It writes the sentence as a comment above `CREATE TABLE sales_order` instead (barwise-qly).

### References

The definitive reference is Terry Halpin and Tony Morgan's _Information Modeling and Relational Databases_ (3rd ed., Morgan Kaufmann / Elsevier, 2024; ISBN 9780443237904) -- the text this project's metamodel is designed against. If you work with ORM, buy Dr. Halpin's book; it is the standard reference for the method, and no tool is a substitute for it. A spaced-repetition Anki deck that drills the concepts, with per-card pointers into the book, lives in [`barwise/docs/anki`](barwise/docs/anki); a transcript of the book's table of contents is in [`barwise/docs/halpin-morgan-3e-contents.md`](barwise/docs/halpin-morgan-3e-contents.md); and a reading guide that says which chapters to read in what order, and what each grounds in the tool, is [`barwise/docs/halpin-morgan-3e-reading-guide.md`](barwise/docs/halpin-morgan-3e-reading-guide.md).

## Prerequisites

| Tool    | Version                                              |
| ------- | ---------------------------------------------------- |
| Node.js | the version in [`.nvmrc`](.nvmrc) (currently 26.7.0) |
| npm     | >= 10                                                |
| VS Code | >= 1.101                                             |

`.nvmrc` is the authority, not this table -- `nvm use` in the repo root
picks it up, and CI reads the same file. The pin is not a preference: V8
leaves functions it never compiled out of its coverage report, so the
same source read 95% on one Node major and 81% on another, and the
coverage gate passes or fails by whichever Node you happen to have. Note
that `.npmrc` does not set `engine-strict`, so npm will only _warn_ on a
mismatched major rather than stop you.

## Installation (prebuilt)

Every merge to `main` rebuilds three downloadable artifacts and refreshes
the moving [`edge`](https://github.com/semantic-praxis/barwise/releases/tag/edge)
pre-release, so a current build always exists without a version tag per
merge. For a stable build, use the latest
[versioned release](https://github.com/semantic-praxis/barwise/releases)
instead.

| Asset                      | What it is                               |
| -------------------------- | ---------------------------------------- |
| `barwise-vscode-edge.vsix` | the VS Code extension                    |
| `barwise-cli-edge.cjs`     | the `barwise` CLI, a single bundled file |
| `barwise-mcp-edge.cjs`     | the MCP stdio server                     |
| `SHA256SUMS`               | checksums for the three above            |

```sh
gh release download edge --repo semantic-praxis/barwise
sha256sum -c SHA256SUMS

code --install-extension barwise-vscode-edge.vsix
node barwise-cli-edge.cjs --help
```

**Check that the build is the one you want.** The `edge` tag moves to
each build's commit, and the release title carries the same thing in
readable form (`Edge build <sha> (<date>)`).

**If you have a clone of this repository, run this once:**

```bash
git config --add remote.origin.fetch '+refs/tags/*:refs/tags/*'
```

A plain `git pull` is unaffected without it -- it exits 0 and updates
your branch, because git adds tags you are missing and skips ones you
already have rather than overwriting them. But an explicit `git fetch
--tags` will fail with "would clobber existing tag" until you add that
line, which makes tag updates forced. Do not use `fetch.pruneTags`
instead: it makes even a plain `git pull` fail.

## Installation (from source)

### 1. Clone and install dependencies

```sh
git clone <repo-url> barwise
cd barwise/barwise
npm install
npm run prepare
```

The repository is an npm workspace. `npm install` at the monorepo root (`barwise/`) handles every workspace package.

`npm run prepare` is a separate step because `.npmrc` sets `ignore-scripts=true`, which blocks install-time scripts from dependencies -- and, unavoidably, our own `prepare` hook along with them. It installs the git hooks (husky); skip it and commits bypass the formatting gate. See `docs/specs/supply-chain-hardening.spec.md`.

### 2. Build everything

```sh
npm run build
```

This runs `turbo run build`, which compiles every workspace package in dependency order -- `@barwise/core` first (it has no internal dependencies), the VS Code extension's esbuild bundle last. The full package list and dependency graph live in [`barwise/CLAUDE.md`](barwise/CLAUDE.md).

### 3. Run the tests

```sh
npm test
```

Or target a single package:

```sh
cd packages/core && npx vitest run
```

### 4. Launch the extension

**Option A -- Extension Development Host (recommended for development):**

1. Open the `barwise/barwise` folder in VS Code.
2. Press `F5` (or **Run > Start Debugging**).
3. VS Code opens a new window with the extension loaded.

If there is no `launch.json` yet, create `.vscode/launch.json` with:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Launch Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}/packages/vscode"],
      "outFiles": ["${workspaceFolder}/packages/vscode/dist/**/*.js"],
      "preLaunchTask": "npm: build"
    }
  ]
}
```

**Option B -- Install a VSIX package:**

```sh
cd packages/vscode
npx @vscode/vsce package --no-dependencies
```

This produces a `barwise-vscode-<version>.vsix` file. Install it in VS Code:

```sh
code --install-extension barwise-vscode-<version>.vsix
```

## Configuration

After installing, open **Settings** and search for `barwise`. The key settings are:

| Setting                      | Default                      | Description                                               |
| ---------------------------- | ---------------------------- | --------------------------------------------------------- |
| `barwise.llmProvider`        | `copilot`                    | `copilot` (uses your Copilot subscription) or `anthropic` |
| `barwise.anthropicModel`     | `claude-sonnet-4-5-20250929` | Model ID when using Anthropic directly                    |
| `barwise.copilotModelFamily` | (empty)                      | Preferred Copilot model family (e.g. `claude-sonnet`)     |

With `anthropic`, run **Barwise: Set Anthropic API Key** to store the key in the OS keychain (an `ANTHROPIC_API_KEY` in the editor's environment also works). The `barwise.anthropicApiKey` setting is deprecated: a key in settings can be committed with `.vscode/settings.json`.

## Quick start

The main path needs no API key and no language model: start from a model or an existing schema, read its rules back as sentences, then generate what you build. Work in an empty directory, not in a clone of this repository, so the files the steps write do not land in the checkout. Copy into it the two sample files in [`barwise/examples/getting-started/`](barwise/examples/getting-started/), `shop.orm.yaml` and `shop.sql`. [The CLI guide](barwise/docs/getting-started/cli.md) shows how to put `barwise` on your path, including from the downloaded `.cjs` file. [GETTING_STARTED.md](GETTING_STARTED.md) has the same steps for VS Code and MCP.

1. **Start from a model.** `shop.orm.yaml` is a small hand-written model of customers and sales orders, ready to use. To start from a database you already have instead, import its DDL, which replaces that file:

   ```sh
   barwise import model shop.sql --format ddl --output shop.orm.yaml
   ```

   The import is mechanical. It turns keys, `NOT NULL` and foreign keys into fact types and constraints, and its readings are only as good as the column names. Step 3 shows the ones that read badly; fix them by editing their `readings` in the file.

2. **Check the structure.** `barwise validate shop.orm.yaml` reports structural errors and constraints that contradict each other.

3. **Read the rules back.** `barwise verbalize shop.orm.yaml --counterexamples` prints every rule as a sentence a business expert can confirm or reject ("Each SalesOrder is placed by at least one Customer"), followed by small example sets of facts the rules forbid. This is the review that matters. A model can pass validation and still state the wrong rule; the sentences are how you catch that.

4. **Draw it.** `barwise diagram shop.orm.yaml --output shop.svg` writes the ORM diagram. It prints a deprecation notice that points at an `svg` export format which does not exist yet; `diagram` is still the way to draw a model from the CLI (barwise-zir).

5. **Generate artifacts.** `barwise export shop.orm.yaml --format ddl --dialect snowflake` writes the tables. Other formats include `dbt`, `openapi` and `avro`.

### Drafting a model from a transcript

Barwise can also draft a model from a business conversation using a language model: `barwise import transcript`, the `import_transcript` MCP tool, or **Barwise: Import...** > **From Transcript** in VS Code. The CLI needs a model provider for this: `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in the environment, or an Ollama server on `localhost:11434` (section 2 of [the CLI guide](barwise/docs/getting-started/cli.md)); without one the command fails with `fetch failed`. VS Code uses the settings under Configuration above. Use it to get a first draft quickly, then review it. A language model can misread a business rule, and the result will still validate: validation checks that the model is well formed, not that it says what the business means. The import helps you find what to review:

- **Annotations in the file.** Questions the transcript left open, constraints the model was unsure of, and constraints it could not apply are written into the `.orm.yaml` as `TODO` and `NOTE` comments. Search the file for `TODO` first.
- **Run-to-run disagreement.** `--samples <n>` (CLI and MCP) extracts the model two to five times and reports every element the runs disagree on as an ambiguity, which is where the transcript leaves the answer open. It writes the run that agrees most with the others. It costs n times as much.
- **The reasoning behind the draft.** `--trail` writes a `.trail.json` file beside the model with the ambiguities found and the low-confidence assumptions the draft still depends on. Add `--alternatives` to include the framing it set aside at the biggest structural choice.
- **Reviewing changes to an existing model.** Importing into a model that already exists merges into it: the CLI accepts additions and changes and skips removals, and VS Code shows a dialog listing each added, changed or removed element, with removals unchecked by default. Commit the model first anyway: the merge rewrites the file, so comments in it, earlier `TODO` and `NOTE` lines included, do not survive, and if the existing file cannot be read as a model, or the merge fails, the CLI writes the new draft over it (barwise-ihc). A first import into a new file has no review step, so read the result with `barwise verbalize` before relying on it.

```sh
barwise import transcript order-management.md --output orders.orm.yaml --samples 3 --trail
barwise verbalize orders.orm.yaml
```

Copy `order-management.md`, or another sample transcript, from [`barwise/examples/transcripts/`](barwise/examples/transcripts/) into the same directory first. The same **Barwise: Import...** picker in VS Code also imports dbt projects and TypeScript, Java and Kotlin code.

Every CLI command is documented in [`barwise/docs/CLI.md`](barwise/docs/CLI.md), and every MCP tool in [`barwise/docs/MCP.md`](barwise/docs/MCP.md).

## Project structure

```
barwise/
  examples/
    transcripts/                       -- sample transcripts for transcript import
  packages/
    core/          @barwise/core          -- metamodel, validation, verbalization, mapping, diff/merge
    diagram/       @barwise/diagram       -- diagram layout
    diagram-ui/    @barwise/diagram-ui    -- React diagram renderer (interactive + headless SVG)
    llm/           @barwise/llm           -- LLM transcript extraction and model review
    code-analysis/ @barwise/code-analysis -- TypeScript/Java/Kotlin code importers
    dbt/           @barwise/dbt           -- dbt project importer/exporter
    formats/       @barwise/formats       -- DDL/OpenAPI/Avro/NORMA/SQL interop formats
    learn/         @barwise/learn         -- modeling gym and tutorial renderer
    promptlab/     @barwise/promptlab     -- deterministic prompt evaluation
    cli/           @barwise/cli           -- the barwise command-line tool
    mcp/           @barwise/mcp           -- MCP server (tools, resources, prompts)
    vscode/        barwise-vscode         -- VS Code extension (language server + commands)
  docs/
    ARCHITECTURE.md                    -- historical design record (see CLAUDE.md for current state)
    CLI.md, MCP.md                     -- command and tool references
  CLAUDE.md                          -- conventions, dependency graph, development commands
```

## Static analysis and coverage

**Linting** uses ESLint with the TypeScript plugin (flat config at the monorepo root). Run across all packages:

```sh
npm run lint
```

**Test coverage** is enforced via `@vitest/coverage-v8` with per-package thresholds. Run coverage for a single package:

```sh
cd packages/core && npx vitest run --coverage
```

Each package declares its own thresholds in its `vitest.config.ts`; CI enforces them via `npm run test:coverage`.

## Commands reference

| Command                                         | Description                        |
| ----------------------------------------------- | ---------------------------------- |
| `npm run build`                                 | Build all packages (via Turborepo) |
| `npm test`                                      | Run all tests                      |
| `npm run lint`                                  | Lint all packages (ESLint)         |
| `npm run clean`                                 | Remove all `dist/` directories     |
| `cd packages/core && npx vitest run`            | Run core tests only                |
| `cd packages/core && npx vitest run --coverage` | Run core tests with coverage       |
| `cd packages/core && npx tsc --noEmit`          | Type-check core only               |
