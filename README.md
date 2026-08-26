# barwise

Object-role modeling for VS Code. Transform business concepts into precise, fact-oriented schemas that everyone can understand.

Barwise is an [ORM 2](https://en.wikipedia.org/wiki/Object-role_modeling) modeling tool built for data engineers and architects. It ships as a VS Code extension backed by a platform-independent core library, so all model logic is testable without launching an editor.

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

The repository is an npm workspace. `npm install` at the monorepo root handles all four packages (`core`, `llm`, `diagram`, `vscode`).

`npm run prepare` is a separate step because `.npmrc` sets `ignore-scripts=true`, which blocks install-time scripts from dependencies -- and, unavoidably, our own `prepare` hook along with them. It installs the git hooks (husky); skip it and commits bypass the formatting gate. See `docs/specs/supply-chain-hardening.spec.md`.

### 2. Build everything

```sh
npm run build
```

This runs `turbo run build`, which compiles the packages in dependency order:

1. `@barwise/core` -- metamodel, validation, verbalization, diff/merge
2. `@barwise/llm` -- LLM-powered transcript extraction
3. `@barwise/diagram` -- ORM diagram layout and SVG rendering
4. `packages/vscode` -- VS Code extension (esbuild bundle)

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

This produces a `barwise-vscode-0.1.0.vsix` file. Install it in VS Code:

```sh
code --install-extension barwise-vscode-0.1.0.vsix
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

1. **Create a project:** run the command **ORM: New Project** from the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`).
2. **Import a transcript:** run **ORM: Import Transcript**, pick a `.md` or `.txt` file containing a business conversation, and name the model. The LLM extracts object types, fact types, and constraints into a `.orm.yaml` file. Try one of the example transcripts in `examples/transcripts/` to get started.
3. **Review changes:** if the `.orm.yaml` already exists, the import shows a fact-by-fact review dialog. Each added, modified, or removed element gets its own checkbox -- additions and modifications are pre-selected, removals require explicit opt-in.
4. **Validate:** run **ORM: Validate Model** to check structural rules and constraint consistency.
5. **Visualize:** run **ORM: Show Diagram** to see the ORM diagram.
6. **Verbalize:** run **ORM: Verbalize Model** to generate natural-language readings of all fact types and constraints.

## Project structure

```
barwise/
  examples/
    transcripts/                 -- sample transcripts for ORM: Import Transcript
  packages/
    core/       @barwise/core     -- metamodel, validation, verbalization, diff/merge
    llm/        @barwise/llm      -- LLM transcript extraction
    diagram/    @barwise/diagram  -- diagram layout and SVG rendering
    vscode/     barwise-vscode    -- VS Code extension (language server + commands)
  docs/
    ARCHITECTURE.md              -- full system design and phasing plan
  CLAUDE.md                      -- conventions and development commands
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

Current coverage thresholds:

| Package   | Statements | Branches | Functions | Lines |
|-----------|------------|----------|-----------|-------|
| core      | 90%        | 84%      | 90%       | 90%   |
| llm       | 78%        | 82%      | 100%      | 78%   |
| diagram   | 94%        | 80%      | 100%      | 94%   |

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
