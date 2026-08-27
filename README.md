# barwise

Object-role modeling for data engineers and architects. Transform business concepts into precise, fact-oriented schemas that everyone can understand.

Barwise is an [ORM 2](https://en.wikipedia.org/wiki/Object-role_modeling) modeling toolkit. It ships as a VS Code extension, a `barwise` CLI, and an MCP server, all backed by the same platform-independent `@barwise/core` library, so all model logic is testable without launching an editor.

## Learning ORM

Barwise assumes familiarity with Object-Role Modeling. The definitive reference is Terry Halpin and Tony Morgan's _Information Modeling and Relational Databases_ (3rd ed., Morgan Kaufmann / Elsevier, 2024; ISBN 9780443237904) -- the text this project's metamodel is designed against. If you work with ORM, buy Dr. Halpin's book; it is the standard reference for the method, and no tool is a substitute for it. A spaced-repetition Anki deck that drills the concepts, with per-card pointers into the book, lives in [`barwise/docs/anki`](barwise/docs/anki); a transcript of the book's table of contents is in [`barwise/docs/halpin-morgan-3e-contents.md`](barwise/docs/halpin-morgan-3e-contents.md).

## Prerequisites

| Tool    | Version   |
|---------|-----------|
| Node.js | >= 20.0.0 |
| npm     | >= 10     |
| VS Code | >= 1.93   |

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

| Setting                     | Default    | Description                                              |
|-----------------------------|------------|----------------------------------------------------------|
| `barwise.llmProvider`        | `copilot`  | `copilot` (uses your Copilot subscription) or `anthropic` |
| `barwise.anthropicApiKey`    | (empty)    | Anthropic API key (falls back to `ANTHROPIC_API_KEY` env var) |
| `barwise.anthropicModel`     | `claude-sonnet-4-5-20250929` | Model ID when using Anthropic directly                   |
| `barwise.copilotModelFamily` | (empty)    | Preferred Copilot model family (e.g. `claude-sonnet`)     |

## Quick start

1. **Create a project:** run the command **Barwise: New Project** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. **Import a transcript:** run **Barwise: Import...** and choose **From Transcript**, pick a `.md` or `.txt` file containing a business conversation, and name the model. The LLM extracts object types, fact types, and constraints into a `.orm.yaml` file. Try one of the example transcripts in `barwise/examples/transcripts/` to get started. The same picker also imports from dbt projects and TypeScript/Java/Kotlin code.
3. **Review changes:** if the `.orm.yaml` already exists, the import shows a fact-by-fact review dialog. Each added, modified, or removed element gets its own checkbox -- additions and modifications are pre-selected, removals require explicit opt-in.
4. **Validate:** run **Barwise: Validate Model** to check structural rules and constraint consistency.
5. **Visualize:** run **Barwise: Show Diagram** to see the ORM diagram.
6. **Verbalize:** run **Barwise: Verbalize Model** to generate natural-language readings of all fact types and constraints.

The same capabilities are available from the terminal via the `barwise` CLI (see [`barwise/docs/CLI.md`](barwise/docs/CLI.md)) and to MCP clients via the MCP server (see [`barwise/docs/MCP.md`](barwise/docs/MCP.md)).

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

| Command                   | Description                                         |
|---------------------------|-----------------------------------------------------|
| `npm run build`           | Build all packages (via Turborepo)                  |
| `npm test`                | Run all tests                                       |
| `npm run lint`            | Lint all packages (ESLint)                          |
| `npm run clean`           | Remove all `dist/` directories                      |
| `cd packages/core && npx vitest run`            | Run core tests only          |
| `cd packages/core && npx vitest run --coverage`  | Run core tests with coverage |
| `cd packages/core && npx tsc --noEmit`           | Type-check core only         |
