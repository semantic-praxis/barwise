# Wiring `.orm-project.yaml` through the user-facing surfaces

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-21
Last-updated: 2026-06-21 (WS4 schema-registration decision)
Tracking: barwise-r4f, barwise-knq (multi-file workflow),
barwise-e4k (splitting guide, blocked on this), deferred
barwise-hwe / barwise-byy / barwise-sa4

## Principle / problem

The project machinery is built; the surfaces only half-expose it. `core`
fully supports a multi-domain `OrmProject` -- model, round-trip serializer
(`ProjectSerializer`), pure assembly (`projectAssembly`), cross-domain
validation (`projectRules`), and a JSON Schema. The CLI already routes a
`.orm-project.yaml` through `validate` and `diagram --domain`, and has
`project init` / `project split`. But `verbalize`, `export`, `describe`, and
`query` silently treat a manifest as a single model and fail; the MCP tools
have no project branch at all; and the VS Code LSP, language registration,
and schema validation ignore `.orm-project.yaml` entirely. So a user who
splits a model (the `project split` command, and the guide that
barwise-e4k will write) cannot then _use_ the result across the toolchain.

This is a composability gap, not a new capability: the one-way `core` API
already returns the domains and resolves cross-domain refs; the surfaces
just need to call it through one shared resolver and a uniform `--domain`
selector, the way `diagram` already does. The fix preserves orthogonality
(each surface is independent) and explicit-over-implicit (a project is
detected by its `.orm-project.yaml` extension; a domain is chosen by an
explicit `--domain`, never inferred).

## The audit (barwise-r4f deliverable)

| Surface | Already works                                      | Gap (this spec fixes)                           | Defer / track                                  |
| ------- | -------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------- |
| CLI     | validate, diagram (`--domain`), project init/split | verbalize, export, describe, query              | diff (project-level), schema (deprecated)      |
| MCP     | (none -- all single-model)                         | resolve project branch + `domain` on read tools | merge, import_transcript domain                |
| VS Code | activates on manifest; reads project settings      | LSP + language + schema-validation registration | Show Diagram picker, Validate cmd, New Project |
| Core    | OrmProject, serializer, assembly, rules, schema    | (complete -- no change)                         | --                                             |

The acceptance bar (`validate <project>` and `diagram <project> --domain
<name>`) is already met today; the value of r4f is making the rest of the
surface consistent with it, and tracking the genuinely harder cases.

## The shared resolver (the one new primitive)

Every read/analyze command needs the same thing: turn a `<file>` (single
model or project manifest) plus an optional `--domain` into the model(s) to
operate on. `diagram` open-codes this; factor it into one helper so the gap
commands reuse it rather than each re-implementing the project branch.

```
// cli/src/helpers (beside projectLoader.ts)
interface ResolvedDomain { context?: string; model: OrmModel; }

// single model            -> [{ model }]
// project + --domain X     -> [{ context: X, model }]  (error if X unknown)
// project, no --domain     -> one entry per domain, each labelled
function resolveDomainModels(file: string, domain?: string): {
  resolved: ResolvedDomain[];
  problems: string[];   // assembly warnings, surfaced once
}
```

Single-output text commands (`verbalize`, `describe`, `query`) loop the
resolved list: with `--domain` they print just that domain; without, they
print each domain under a `== <context> ==` header (so a project is
verbalized in full, not refused). `export` follows `diagram`'s shape -- one
file per domain into `--output <dir>`, or one domain with `--domain`. The
MCP resolver mirrors this so a tool's `source` may be a manifest and an
optional `domain` arg selects one.

## Scope

In scope (fix now):

- CLI: `verbalize`, `export`, `describe`, `query` accept a
  `.orm-project.yaml` with the uniform `--domain` selector, via the shared
  resolver. Single-output commands do per-domain sections when no domain is
  given.
- MCP: a project branch in `helpers/resolve.ts` and an optional `domain`
  input on the read tools (`validate_model`, `verbalize_model`,
  `export_model`, `query_model`, `review_model`; `generate_diagram` if not
  fully deprecated).
- VS Code: register `.orm-project.yaml` so the LSP gives diagnostics/hover
  on the manifest, and wire the existing `orm-project.schema.json` for
  editor validation (`contributes.languages` + LSP manifest diagnostics).

Out of scope (track as follow-ups):

- Project-level `diff` (two manifests): needs a design call -- per-domain
  pairing plus manifest-structure changes (domains added/removed, mapping
  edits). Its own issue.
- VS Code `Show Diagram` / `Validate` commands taking a project with a
  domain quick-pick UI: real value, but UI work; separate issue.
- `Validate Model` command vs LSP diagnostics: once the LSP handles
  projects, the command is redundant -- decide deprecation then.
- The deprecated `schema` command and `New Project` (scaffold a manifest,
  not a model) -- minor; track.

## Inventory

| Module                                                  | Change                                                                    |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| `cli/src/helpers/projectLoader.ts` (+ io.ts)            | Add `resolveDomainModels(file, domain?)` -> list of `{ context?; model }` |
| `cli/src/commands/{verbalize,describe,query}.ts`        | Accept a project file; `--domain` selects one, else per-domain sections   |
| `cli/src/commands/export.ts`                            | Accept a project; `--domain` one, else per-domain files (like diagram)    |
| `mcp/src/helpers/resolve.ts`                            | Add a project branch; expose a `domain` arg for the read tools            |
| `mcp/src/tools/{validate,verbalize,exportModel,...}.ts` | Optional `domain` input; route project source through resolve             |
| `vscode/src/server/OrmLanguageServer.ts`                | Route `.orm-project.yaml` to manifest validation (`validateProject`)      |
| `vscode/src/server/DiagnosticsProvider.ts`              | `validateProject` -- schema-validate the manifest via `ProjectSerializer` |
| `vscode/package.json`                                   | Register the `orm-project` language (associate `.orm-project.yaml`)       |

## Workstreams (each its own PR, suite green)

Ordered smallest-blast-radius first; the shared resolver lands first so the
commands reuse it.

1. CLI shared resolver + `verbalize` / `describe` / `query`. Extract
   `resolveDomainModels`; reroute the three text commands through it;
   per-domain sections when no `--domain`. Tests: a project verbalizes all
   domains; `--domain` selects one; an unknown domain errors with the
   available list (mirroring `diagram`'s test).
2. CLI `export` for projects. Per-domain files into `--output <dir>`, or one
   domain via `--domain`, matching `diagram`'s contract. Tests per format.
3. MCP project branch. `resolve.ts` detects a manifest and assembles; read
   tools gain an optional `domain`. Tests: a tool over a project source with
   and without `domain`.
4. VS Code LSP + schema registration. `.orm-project.yaml` in the document
   selector; `contributes.languages` for the `orm-project` language. The LSP
   validates a manifest against `orm-project.schema.json` via core's
   `ProjectSerializer` and reports parse/schema errors -- mirroring how a
   `.orm.yaml` model is LSP-validated rather than via a static schema entry.
   (Resolved during WS4: `contributes.jsonValidation` was the original plan,
   but VS Code applies it only to JSON, not YAML; routing manifest validation
   through the LSP is both functional and consistent with the model path.
   Full cross-file project diagnostics -- resolving and validating each
   referenced domain with line mapping -- stay deferred to barwise-sa4.)

## API and migration impact

- No `core` change -- this is surface wiring over the existing `OrmProject`
  API. No `.orm.yaml` / `.orm-project.yaml` format change; no `orm_version`
  bump.
- The CLI commands gain a `--domain` option and project-file acceptance;
  single-model behavior is unchanged (the resolver's single-model branch is
  today's path). MCP read tools gain an optional `domain` field (additive).
- VS Code gains language/schema registration for a new file extension;
  no behavior change for `.orm.yaml`.

## Open decisions (for review)

- **Per-domain sections vs require `--domain` for text commands (recommend:
  per-domain sections).** Verbalizing/describing a whole project under
  `== <context> ==` headers is more useful than refusing without a domain,
  and matches how a reader thinks about a project. `--domain` stays the way
  to narrow. The alternative (require `--domain`) is simpler but less
  helpful.
- **Project `diff` now or deferred (recommend: defer).** Manifest-level diff
  has real design surface (domain set changes, mapping edits, per-domain
  model diffs); better as its own spec than bolted on here.
- **MCP `domain` as a tool input vs a project-expanding response (recommend:
  input arg).** A `domain` arg keeps each tool single-result and matches the
  CLI; expanding a project into N results per tool complicates every schema.

## Risks and testing

- Low risk: additive surface wiring over a tested `core` API; single-model
  paths are untouched (guarded by the existing command tests staying green).
- Each CLI workstream ships command tests over a small fixture project
  (reuse the `diagram`/`validate` project fixtures); MCP ships a tool test
  over a project source; the VS Code registration is manual-verify
  (diagnostics appear on a `.orm-project.yaml`).
- The shared resolver is the one place to get right: its three branches
  (single, project+domain, project all) are each covered, including the
  unknown-domain error path.

## Non-goals

- No new project capability -- only exposing the built one.
- No project `diff`, no VS Code diagram/validate project UI, no command
  deprecations (all tracked separately).
- No change to `core`, the file formats, or the one-way dependency graph.
