# Repository analysis: clone, profile, and extract business rules

Status: Phases 1-3 shipped. Phases 1-2: RepoManager clone/pull,
RepoProfiler, six framework detectors, barwise analyze with
--ref/--depth/--profile-only. Phase 3 (2026-07-26): end-to-end
orchestration -- barwise analyze now extracts after profiling (detected
importer over the detected domain scope; --domain/--output; local
directories analyze in place with no clone or auth), the
analyze_repository MCP tool (clone gated behind requiresConfirmation /
confirm=true; returns profile + extracted .orm.yaml), and the VS Code
entry (barwise.analyzeRepository: input boxes, modal clone
confirmation, progress, profile to the output channel, extracted model
opened as an untitled document). Open: re-analysis diffing (--update,
analysis metadata recording) and multi-domain-path merge (multiple
detected paths currently widen the scan to the repo root).
Created: 2026-04-02
Last-updated: 2026-07-26

## Problem

Barwise can extract business rules from code via `barwise import
typescript|java|kotlin <directory>`, but the workflow assumes the
user already has the code on disk and knows which directory to point
at. This breaks down for the primary persona -- a data modeler who
wants to say "analyze the Foo service for business rules" without
understanding how a Spring Boot or NestJS project is laid out.

There is no way to:

1. Reference a remote repository by name (e.g., `MyOrg/Foo`).
2. Automatically detect the framework and locate domain logic.
3. Track which version of a repo was analyzed for later diffing.

The data modeler should not need to clone repos manually, navigate
unfamiliar project structures, or know that Spring Boot entities live
in `src/main/java/**/domain/`.

## Goals

1. Clone a repository by org/name reference with user confirmation,
   manage the local copy, and track the analyzed commit.
2. Automatically detect the language, build system, and application
   framework, then select the directories containing domain logic --
   no user input required for conventional project layouts.
3. Surface the analysis as a single command across CLI, MCP, and
   VS Code, building on the existing `ImportFormat` infrastructure.
4. Support re-analysis: detect when the repo has changed since the
   last analysis and surface only new/changed business rules.

## Non-goals

- Supporting every framework from day one. Start with the most common
  conventions; expand based on demand.
- Deep build-system integration (running Gradle builds, resolving
  Maven dependencies). We detect frameworks from file markers and
  source patterns, not build output.
- Replacing the existing `barwise import <format> <dir>` workflow.
  Repo analysis is a higher-level command that delegates to existing
  format importers after profiling.

## Architecture

### Overview

Repo analysis is a thin orchestration layer on top of existing
capabilities. It adds two new concerns -- repo management and
framework profiling -- then delegates to the existing code-analysis
format importers.

```
"Analyze MyOrg/Foo"
   |
   v
[1] RepoManager -- clone / pull / checkout ref
   |
   v
[2] RepoProfiler -- detect language, framework, scope
   |
   v
[3] Existing ImportFormat.parseAsync() -- TypeCollector, etc.
   |
   v
[4] Existing enrich() -- LLM interpretation
   |
   v
[5] Record analysis metadata in project
```

Steps 3-5 already exist. This spec covers steps 1-2 and the
orchestration that ties them together.

### Package placement

The repo management and profiling logic belongs in
`@barwise/code-analysis`. It already owns the language-specific
importers and has the `node:child_process` and `node:fs` dependencies
needed for git operations and file discovery.

```
code-analysis/src/
  repo/
    RepoManager.ts          Clone, pull, checkout, local path management
    RepoProfiler.ts         Orchestrate detection, produce RepoProfile
    FrameworkDetector.ts     Multi-signal framework detection
    detectors/
      spring.ts             Spring Boot / Spring Framework
      django.ts             Django
      rails.ts              Ruby on Rails
      nestjs.ts             NestJS
      express.ts            Express.js
      fastapi.ts            FastAPI
      dotnet.ts             ASP.NET Core / Entity Framework
      go.ts                 Go (GORM, Ent, sqlc)
      nextjs.ts             Next.js
      laravel.ts            Laravel
    types.ts                RepoProfile, FrameworkSignal, etc.
```

### Dependency graph (unchanged)

```
@barwise/core
  ^
  |--- @barwise/code-analysis  (core; repo + profiler + importers)
  |--- @barwise/diagram        (core)
  |--- @barwise/llm            (core)
  |--- @barwise/cli            (core, diagram, llm, code-analysis)
  |--- @barwise/mcp            (core, diagram, llm, code-analysis)
  |--- barwise-vscode           (core, diagram, llm, mcp, code-analysis)
```

No new packages. No new dependencies beyond what code-analysis
already uses (`node:child_process`, `node:fs`).

## RepoManager

Manages the local lifecycle of external repositories.

### Storage layout

```
~/.barwise/
  repos/
    MyOrg/
      Foo/                  # gh repo clone of MyOrg/Foo
        .git/
        ...
    AnotherOrg/
      Bar/
```

Repos live in `~/.barwise/repos/` (user home directory), not inside
any project. This allows multiple barwise projects to analyze the
same repo without duplicating clones.

### Interface

```typescript
interface RepoManager {
  /**
   * Clone a repository. Returns the local path.
   * Throws if the repo already exists locally (use pull instead).
   */
  clone(repo: RepoRef, options?: CloneOptions): Promise<string>;

  /**
   * Pull latest changes for an already-cloned repo.
   * Returns the new HEAD commit hash.
   */
  pull(repo: RepoRef): Promise<string>;

  /**
   * Checkout a specific ref (branch, tag, or commit).
   */
  checkout(repo: RepoRef, ref: string): Promise<void>;

  /**
   * Get the current HEAD commit hash for a cloned repo.
   */
  head(repo: RepoRef): Promise<string>;

  /**
   * Check if a repo is already cloned locally.
   */
  exists(repo: RepoRef): boolean;

  /**
   * Get the local filesystem path for a repo.
   */
  localPath(repo: RepoRef): string;

  /**
   * Remove a cloned repo from disk.
   */
  remove(repo: RepoRef): Promise<void>;
}

interface RepoRef {
  /** GitHub org or owner. */
  owner: string;
  /** Repository name. */
  name: string;
}

interface CloneOptions {
  /** Ref to checkout after cloning (default: default branch). */
  ref?: string;
  /** Shallow clone depth (default: 1 for analysis, full history not needed). */
  depth?: number;
}
```

### Git operations

All clone operations use the GitHub CLI (`gh`), which handles
authentication automatically via `gh auth`. Subsequent operations
(pull, checkout, rev-parse) use the system `git` binary since the
repo is already authenticated locally. Both are invoked via
`node:child_process.execFile`. No git library dependency.

- **Clone**: `gh repo clone <owner>/<name> <path> -- --depth 1`
- **Pull**: `git pull --ff-only` (fast-forward only, no merge commits)
- **Checkout**: `git checkout <ref>`
- **HEAD**: `git rev-parse HEAD`

Shallow clones are sufficient for static analysis. If the user needs
history (e.g., to diff against a previous version), they can specify
`depth: 0` for a full clone.

### Authentication

Barwise relies on `gh auth` for repository access. On first use, the
RepoManager checks that `gh` is installed and authenticated:

```
$ gh auth status
```

If `gh` is not installed or not authenticated, barwise reports a
clear error with setup instructions:

```
Error: GitHub CLI (gh) is required for repository analysis.
Install: https://cli.github.com
Authenticate: gh auth login
```

If a clone fails due to access denial (HTTP 403/404 from a private
repo the user does not have access to), barwise reports the failure
and suggests checking permissions:

```
Error: Cannot access MyOrg/Foo.
Check that your GitHub account has read access to this repository:
  gh repo view MyOrg/Foo
```

No auth configuration lives in barwise itself -- `gh` owns that
concern entirely.

## RepoProfiler

Takes a local directory (from RepoManager or a user-provided path)
and produces a structured profile describing what kind of project it
is and where the domain logic lives.

### RepoProfile

```typescript
interface RepoProfile {
  /** Detected primary language. */
  language:
    | "typescript"
    | "java"
    | "kotlin"
    | "python"
    | "ruby"
    | "go"
    | "csharp"
    | "php"
    | "unknown";

  /** Detected application framework, if any. */
  framework: FrameworkDetection | null;

  /** Build system detected. */
  buildSystem: BuildSystemDetection | null;

  /** Directories containing domain logic (absolute paths). */
  domainPaths: string[];

  /** Directories to exclude from analysis. */
  excludePaths: string[];

  /** Total source files in scope after filtering. */
  sourceFileCount: number;

  /** Recommended barwise import format to use. */
  importFormat: string;

  /** Human-readable summary for display. */
  summary: string;
}

interface FrameworkDetection {
  /** Framework identifier. */
  name: string;
  /** Confidence based on number of matching signals. */
  confidence: "high" | "medium" | "low";
  /** Which signals matched. */
  signals: FrameworkSignal[];
}

interface FrameworkSignal {
  /** What was found. */
  indicator: string;
  /** Where it was found. */
  location: string;
  /** How strong this signal is on its own. */
  weight: "strong" | "moderate" | "weak";
}

interface BuildSystemDetection {
  name: string;
  /** Path to the build file. */
  buildFile: string;
}
```

### Multi-signal framework detection

The profiler does NOT rely on a single file to identify a framework.
It scores multiple independent signals and requires a threshold before
declaring a framework match. This matters because:

- Spring Boot projects use Maven OR Gradle (Groovy or Kotlin DSL)
- Django projects use pip, Poetry, or uv
- Node projects might be in a monorepo where `package.json` is levels up
- Some projects use multiple frameworks

#### Signal categories

For each framework detector, signals fall into three weight tiers:

**Strong signals** (high confidence on their own):

- Framework-specific config files (`application.yml`, `settings.py`,
  `config/routes.rb`)
- Framework-specific annotations/decorators in source code
  (`@SpringBootApplication`, `@app.route`)

**Moderate signals** (need corroboration):

- Build file dependencies (`spring-boot-starter` in `build.gradle.kts`,
  `django` in `pyproject.toml`)
- Directory conventions (`src/main/java`, `app/models`)

**Weak signals** (supportive but not decisive):

- File naming patterns (`*Controller.java`, `*_views.py`)
- Import statements matching framework packages

#### Detection algorithm

```
For each registered framework detector:
  1. Scan for all matching signals
  2. Score: strong = 3, moderate = 2, weak = 1
  3. If score >= 5 -> high confidence
     If score >= 3 -> medium confidence
     If score >= 2 -> low confidence
     If score < 2  -> no match
  4. Rank frameworks by score, pick highest
```

If multiple frameworks tie (e.g., a project using both Spring Boot
and React), the profiler reports the backend framework as primary
since that is where business rules live. Frontend frameworks are
noted but not prioritized for ORM extraction.

### Framework detectors

Each detector is a self-contained module that knows the conventions
for one framework. Adding support for a new framework means adding
one file to `detectors/` and registering it.

#### Spring Boot / Spring Framework

```typescript
const springDetector: FrameworkDetectorConfig = {
  name: "Spring Boot",
  language: "java", // also "kotlin"
  signals: [
    // Strong
    { glob: "**/application.yml", weight: "strong" },
    { glob: "**/application.properties", weight: "strong" },
    { glob: "**/application-*.yml", weight: "strong" },
    { sourcePattern: /@SpringBootApplication/, weight: "strong" },
    { sourcePattern: /@Entity/, weight: "strong" },

    // Moderate
    { buildDependency: "spring-boot-starter", weight: "moderate" },
    { buildDependency: "org.springframework.boot", weight: "moderate" },
    { glob: "src/main/java/**", weight: "moderate" },
    { glob: "src/main/kotlin/**", weight: "moderate" },

    // Weak
    { sourcePattern: /@Repository/, weight: "weak" },
    { sourcePattern: /@Service/, weight: "weak" },
    { filePattern: "*Controller.java", weight: "weak" },
    { filePattern: "*Controller.kt", weight: "weak" },
  ],
  domainPaths: [
    // Ordered by priority -- first match wins for each category
    "src/main/java/**/domain/**",
    "src/main/java/**/model/**",
    "src/main/java/**/entity/**",
    "src/main/java/**/models/**",
    "src/main/kotlin/**/domain/**",
    "src/main/kotlin/**/model/**",
    "src/main/kotlin/**/entity/**",
    // Fall back to scanning all source for @Entity annotations
    "src/main/java/**",
    "src/main/kotlin/**",
  ],
  excludePaths: [
    "src/test/**",
    "src/main/**/config/**",
    "src/main/**/configuration/**",
    "build/**",
    "target/**",
    ".gradle/**",
  ],
};
```

#### Build system detection

The profiler checks for build files to understand how dependencies
are declared. This feeds into the framework detectors:

| Build file         | System          | Dependency check                        |
| ------------------ | --------------- | --------------------------------------- |
| `pom.xml`          | Maven           | `<artifactId>` elements                 |
| `build.gradle`     | Gradle (Groovy) | `implementation`, `dependencies` blocks |
| `build.gradle.kts` | Gradle (Kotlin) | Same, Kotlin syntax                     |
| `package.json`     | npm/yarn/pnpm   | `dependencies`, `devDependencies`       |
| `pyproject.toml`   | Poetry/uv/pip   | `[project.dependencies]`                |
| `requirements.txt` | pip             | Package names with versions             |
| `Gemfile`          | Bundler         | `gem` declarations                      |
| `go.mod`           | Go modules      | `require` declarations                  |
| `*.csproj`         | .NET            | `<PackageReference>` elements           |
| `composer.json`    | Composer (PHP)  | `require` section                       |

The `buildDependency` signal in framework detectors checks the
resolved build file. For example, `spring-boot-starter` matches if
found in `pom.xml`, `build.gradle`, or `build.gradle.kts`.

#### Django

```typescript
const djangoDetector: FrameworkDetectorConfig = {
  name: "Django",
  language: "python",
  signals: [
    { glob: "**/manage.py", weight: "strong" },
    { glob: "**/settings.py", weight: "strong" },
    { sourcePattern: /from django\.db import models/, weight: "strong" },
    { buildDependency: "django", weight: "moderate" },
    { buildDependency: "Django", weight: "moderate" },
    { glob: "**/models.py", weight: "moderate" },
    { glob: "**/urls.py", weight: "weak" },
    { glob: "**/admin.py", weight: "weak" },
  ],
  domainPaths: [
    "**/models.py",
    "**/models/**/*.py",
  ],
  excludePaths: [
    "**/migrations/**",
    "**/tests/**",
    "**/test_*.py",
    "**/*_test.py",
    "**/manage.py",
    "**/settings.py",
    "**/urls.py",
    "**/admin.py",
    "**/apps.py",
  ],
};
```

#### NestJS

```typescript
const nestjsDetector: FrameworkDetectorConfig = {
  name: "NestJS",
  language: "typescript",
  signals: [
    { glob: "**/nest-cli.json", weight: "strong" },
    { sourcePattern: /@nestjs\/common/, weight: "strong" },
    { sourcePattern: /@Module\(/, weight: "strong" },
    { buildDependency: "@nestjs/core", weight: "moderate" },
    { buildDependency: "@nestjs/common", weight: "moderate" },
    { filePattern: "*.module.ts", weight: "weak" },
    { filePattern: "*.controller.ts", weight: "weak" },
    { filePattern: "*.service.ts", weight: "weak" },
  ],
  domainPaths: [
    "src/**/entities/**",
    "src/**/models/**",
    "src/**/domain/**",
    "src/**/*.entity.ts",
    "src/**",
  ],
  excludePaths: [
    "node_modules/**",
    "dist/**",
    "test/**",
    "**/*.spec.ts",
    "**/*.test.ts",
    "src/**/dto/**",
    "src/**/*.dto.ts",
    "src/**/*.module.ts",
  ],
};
```

#### Additional detectors (initial set)

Similar patterns for:

- **Express.js** -- `express` dependency, `app.get/post/put/delete`
  patterns, `routes/` directory
- **FastAPI** -- `fastapi` dependency, `@app.get` decorators,
  Pydantic models
- **Rails** -- `Gemfile` with `rails`, `app/models/`, `db/migrate/`
- **ASP.NET Core** -- `*.csproj` with `Microsoft.AspNetCore`,
  `[ApiController]`, `Models/` directory
- **Go** -- `go.mod`, check for GORM (`gorm.io/gorm`), Ent
  (`entgo.io/ent`), sqlc patterns
- **Next.js** -- `next.config.*`, `@next/` dependencies, `app/` or
  `pages/` directories
- **Laravel** -- `composer.json` with `laravel/framework`,
  `app/Models/`, `database/migrations/`

Each detector follows the same `FrameworkDetectorConfig` structure.
New detectors are registered in a detector registry; adding one
requires no changes to the profiler itself.

### Domain path resolution

After framework detection, the profiler resolves `domainPaths` globs
against the actual filesystem. The result is a concrete list of
directories and files to analyze.

For projects where no framework is detected (or an unknown framework),
the profiler falls back to language-based heuristics:

| Language   | Fallback domain paths                               |
| ---------- | --------------------------------------------------- |
| TypeScript | `src/`, excluding `node_modules`, `dist`, `test`    |
| Java       | `src/main/java/`, excluding `test`                  |
| Kotlin     | `src/main/kotlin/`, excluding `test`                |
| Python     | All `*.py` excluding `test_*`, `*_test.py`, `setup` |
| Go         | All `*.go` excluding `*_test.go`, `vendor`          |

The fallback is intentionally broad. It is better to analyze too much
and let the LLM filter than to miss domain logic because a project
does not follow conventions.

### Profile summary

The profiler produces a human-readable summary for display:

```
Spring Boot / Kotlin project (high confidence)
Build system: Gradle (build.gradle.kts)
Domain logic: 23 files in src/main/kotlin/com/acme/foo/domain/
              15 files in src/main/kotlin/com/acme/foo/model/
Signals: application.yml, @Entity (14 files), @SpringBootApplication,
         spring-boot-starter-data-jpa in build.gradle.kts
Recommended import format: kotlin
```

The data modeler sees this, not a list of directories to choose from.

## Analysis metadata

After analysis, the following metadata is recorded in the ORM project
file (`.orm-project.yaml`) or a sidecar file:

```yaml
analyses:
  - repo: MyOrg/Foo
    commit: a1b2c3d4e5f6
    ref: main
    timestamp: 2026-03-27T12:00:00Z
    framework: Spring Boot
    language: kotlin
    domainPaths:
      - src/main/kotlin/com/acme/foo/domain/
      - src/main/kotlin/com/acme/foo/model/
    sourceFiles: 38
    extractedConstraints: 47
    importFormat: kotlin
```

This enables:

- **Re-analysis**: pull latest, compare commit hashes, re-analyze
  only if changed.
- **Diff**: compare constraints extracted at commit A vs. commit B.
- **Audit trail**: which version of which repo produced which
  constraints in the model.

## Entry points

### CLI

```bash
# Analyze a GitHub repo (clones to ~/.barwise/repos/)
barwise analyze MyOrg/Foo

# Analyze with a specific ref
barwise analyze MyOrg/Foo --ref v2.3.0

# Analyze with a specific ref and domain name
barwise analyze MyOrg/Foo --ref v2.3.0 --domain "Order Management"

# Re-analyze (pulls latest, diffs against previous analysis)
barwise analyze MyOrg/Foo --update

# Analyze an already-cloned local directory
barwise analyze ./path/to/repo

# Profile only (no extraction, just show what was detected)
barwise analyze MyOrg/Foo --profile-only

# Specify output model
barwise analyze MyOrg/Foo --output order-management.orm.yaml
```

The `analyze` command is a high-level orchestrator:

1. Resolve repo reference (clone/pull via RepoManager, or use local path)
2. Profile the repo (RepoProfiler)
3. Display the profile summary
4. Run `import <detected-format> <detected-scope>`
5. Record analysis metadata

### MCP

```typescript
server.registerTool("analyze_repository", {
  description:
    "Clone, profile, and extract business rules from a code repository",
  inputSchema: {
    repo: z.string().describe(
      "GitHub org/repo (e.g., 'MyOrg/Foo') or local path",
    ),
    ref: z.string().optional().describe("Branch, tag, or commit to analyze"),
    domain: z.string().optional().describe(
      "Domain name for the extracted model",
    ),
    guidingModel: z.string().optional().describe(
      "Path to existing .orm.yaml to enrich",
    ),
    profileOnly: z.boolean().optional().describe(
      "Only profile, do not extract",
    ),
    output: z.string().optional().describe("Output .orm.yaml path"),
  },
});
```

The MCP tool returns the profile summary and extraction results in a
single response. For the confirmation step (before cloning), the tool
returns the profile with a `needsConfirmation: true` flag, and the
client (Claude Code, Cursor, etc.) presents it to the user.

### VS Code

The existing "ORM: Import..." command gains an "Analyze Repository"
option. Flow:

1. User selects "Analyze Repository"
2. InputBox: enter org/repo or browse to local directory
3. QuickPick: select ref (lists branches/tags from remote)
4. Confirmation: "Clone MyOrg/Foo to .barwise/repos/? [Yes/No]"
5. Progress indicator: "Profiling repository..."
6. Display profile summary in output channel
7. Progress indicator: "Extracting business rules..."
8. Open merge UI if an existing model is found

## Confirmation UX

Cloning a repository is a side effect that should be explicit. Each
surface handles confirmation differently:

- **CLI**: prints the profile summary and prompts
  `Clone MyOrg/Foo (depth 1, ref main) to ~/.barwise/repos/MyOrg/Foo? [Y/n]`
  Use `--yes` flag to skip confirmation in scripts.
- **MCP**: returns the profile with `requiresConfirmation: true`.
  The AI client (Claude Code, etc.) presents it and asks the user.
- **VS Code**: shows a modal dialog with the profile summary and
  Yes/No buttons.

For repos that are already cloned, no confirmation is needed -- the
tool pulls latest and proceeds.

## Re-analysis and diffing

When `barwise analyze MyOrg/Foo` is run against a repo that was
previously analyzed:

1. Pull latest changes.
2. Compare HEAD against the recorded commit in analysis metadata.
3. If unchanged: "No changes since last analysis (commit a1b2c3d)."
4. If changed: re-analyze and produce a diff of extracted constraints.
   Display: "3 new constraints, 1 modified, 0 removed since a1b2c3d."

This uses the existing `ModelDiff` infrastructure from
`@barwise/core`. The diff is between the previously-extracted model
and the newly-extracted model.

## Testing strategy

### Unit tests

- **RepoManager**: mock `child_process.execFile` to verify correct
  git commands are constructed. Test path resolution, existence checks,
  error handling (repo not found, auth failure).
- **RepoProfiler**: given a mock filesystem (directory listings and
  file contents), verify correct `RepoProfile` output.
- **Framework detectors**: given specific file trees and file contents,
  verify signal matching and scoring. Test each detector independently.
- **Build system detection**: given various `pom.xml`,
  `build.gradle.kts`, `package.json`, `pyproject.toml` contents,
  verify correct dependency extraction.

### Integration tests

- **Profile real fixture projects**: small fixture directories in
  `tests/fixtures/repos/` that mimic the structure of Spring Boot,
  Django, NestJS, etc. projects. Verify the profiler produces correct
  profiles end-to-end.
- **Clone and profile**: integration test that clones a small public
  repo (or uses a local git init), profiles it, and verifies the
  result. Requires git on the system.

### Fixture repos

```
tests/fixtures/repos/
  spring-boot-kotlin/       # Minimal Spring Boot + Kotlin project
    build.gradle.kts
    src/main/kotlin/com/example/domain/
      Order.kt              # @Entity with validation annotations
    src/main/resources/
      application.yml
  django-app/               # Minimal Django project
    manage.py
    myapp/
      models.py             # Django models
      settings.py
  nestjs-app/               # Minimal NestJS project
    nest-cli.json
    package.json
    src/
      entities/
        user.entity.ts
  express-app/              # Express with no framework markers
    package.json
    src/
      models/
        order.ts
  unknown-structure/        # No framework detected, fallback
    src/
      main.ts
```

## Implementation phases

### Phase 1: RepoManager and basic profiling

**Goal**: Clone repos by org/name reference, detect language and
build system.

**Deliverables**:

- `RepoManager` with clone, pull, checkout, head, exists, localPath
- Language detection from file extensions
- Build system detection from build files
- CLI `barwise analyze <repo> --profile-only` showing language and
  build system
- Unit tests with mocked git commands
- Integration test with local git init

### Phase 2: Framework detection

**Goal**: Multi-signal framework detection for the initial set of
frameworks.

**Deliverables**:

- `FrameworkDetector` with scoring algorithm
- Detectors for: Spring Boot, Django, NestJS, Express, FastAPI, Rails
- Domain path resolution from framework conventions
- `RepoProfile.summary` generation
- CLI `barwise analyze <repo> --profile-only` showing full profile
- Unit tests for each detector with fixture directories

### Phase 3: End-to-end orchestration

**Goal**: Wire profiling into the existing import pipeline. Full
`barwise analyze` command working end-to-end.

**Deliverables**:

- CLI `barwise analyze` command (clone, profile, import, record)
- MCP `analyze_repository` tool
- VS Code "Analyze Repository" command
- Analysis metadata recording in project file
- Confirmation UX across all three surfaces
- Integration tests with fixture repos

### Phase 4: Re-analysis and additional detectors

**Goal**: Support re-analysis with diffing. Add remaining framework
detectors.

**Deliverables**:

- Pull-and-diff workflow for previously-analyzed repos
- `--update` flag on CLI
- Detectors for: ASP.NET Core, Go (GORM/Ent), Next.js, Laravel
- Additional build system support as needed

## Resolved decisions

1. **Authentication for private repos.** Resolved: use `gh auth`
   exclusively. Barwise does not manage credentials. Clone failures
   due to access denial produce a clear error message suggesting the
   user check their GitHub permissions. See the Authentication
   section above.

2. **Non-GitHub remotes.** Resolved: deferred. GitHub is the only
   supported remote for the initial implementation. `RepoRef` uses
   `owner` + `name` (no arbitrary URL field). Support for GitLab,
   Bitbucket, and Azure DevOps can be added later if needed.

3. **Repo storage location.** Resolved: `~/.barwise/repos/` (user
   home directory). Repos are shared across barwise projects to avoid
   duplicate clones.

4. **Monorepo support.** Resolved: detect monorepo structure (Nx,
   Turborepo, Maven multi-module, Gradle multi-project) and list
   discovered services/modules for the user to pick. If the user
   does not know which to pick (e.g., a data modeler unfamiliar with
   the codebase), offer an "all" option that analyzes the entire repo.
   Each surface handles this naturally:
   - **CLI**: list services, prompt for selection, default to "all"
   - **MCP**: return the service list; the AI client picks or asks
   - **VS Code**: QuickPick with multi-select and an "Analyze All"
     option

5. **Unsupported languages.** Resolved: detect all frameworks
   regardless of importer support. For languages without a dedicated
   importer (Python, Go, Ruby, etc.), note the detection in the
   profile summary and fall back to LLM-based extraction using raw
   source files as context. Lower quality than LSP-based analysis
   but still useful. Dedicated importers can be added later when use
   cases justify the work.

6. **Profile caching.** Resolved: cache the `RepoProfile` and skip
   re-profiling when the cache is valid. The cache key is:
   `(repo, commit, barwise_version, guiding_model_hash, scope_path)`.
   Any change to these values invalidates the cache and triggers a
   fresh profile. Rationale:
   - **repo + commit**: source code changed
   - **barwise_version**: new or improved framework detectors
   - **guiding_model_hash**: different model focuses analysis on
     different entities, potentially changing scope
   - **scope_path**: user-specified subtree differs from cached run
