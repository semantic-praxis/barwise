# Surface parity audit, 2026-10-12

A snapshot, taken on `main` at `380575e4` (version 1.7.0) while writing the
getting-started guides (barwise-jk7, `docs/specs/getting-started-guides.spec.md`).
It is not maintained. Each finding lives on in its tracker issue; which
surface is meant to reach which capability is recorded in the capability
matrix in the root `CLAUDE.md`.

**Read it beside `docs/cli-surface-audit-2026-10-12.md` (barwise-0wa).** That
audit landed on `main` the same day. It checks the CLI against MCP and VS Code
option by option, and it records the owner's direction that MCP and VS Code
should mirror the CLI's toolset, so it is the plan of record for closing gaps.
This audit adds the runtime behavior behind the names: what a step writes,
which build it runs in, and what a new user meets first. Where the two found
the same thing, the issues cross-reference, and this audit's duplicate of
barwise-0wa.qh3 was withdrawn. `main` has also added `split_model` to MCP and
VS Code since this snapshot.

**Result: nine defects on the getting-started path, seven of which make one
step behave differently by surface or by build; four gaps in reach that the
capability matrix does not mark; setup documentation that contradicted the
code, corrected here; and three incidental import/export defects.** The two most serious are behavioral:
`merge_models` overwrites its base file on MCP and VS Code while the CLI's
`merge` never touches its inputs, and a multi-domain project with a broken
mapping fails `barwise validate` but passes `validate_model`.

## Method

- **CLI**: every command in `docs/getting-started/cli.md` was run from a
  scratch directory, against both the tsc build (`packages/cli/dist/index.js`)
  and the release bundle (`packages/cli/dist/bundle/index.cjs`).
- **MCP**: a script using the MCP SDK client drove the server over stdio the
  way a user's client would, against three entry points: the tsc build
  (`packages/mcp/dist/index.js`), the release bundle
  (`packages/mcp/dist/bundle/index.cjs`), and the server the VS Code extension
  embeds (`packages/vscode/dist/mcp/index.js`).
- **VS Code**: read from `packages/vscode/package.json` (commands, settings,
  chat tools, chat participant) and the command and tool sources. No live
  editor was driven.
- **Not exercised**: anything that calls an LLM. The authoring session had no
  provider key, so transcript import and review were checked only for their
  options and their keyless failure.

## Defects on the getting-started path

The first seven rows make one step give a different result depending on the
surface or the build. The last two behave the same on the CLI and MCP, and are
here because a new user meets them in their first hour.

| Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Issue           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **Merge writes to different places.** `barwise merge` never modifies either input. `merge_models` (and `#barwiseMerge`, which wraps it) writes the merged model over the base file whenever the base is a path; the release bundle returned `writtenTo` and the file on disk changed. The write-back is a recorded decision (`cli-surface-parity.spec.md`), but the capability matrix row reads "none" and neither the tool description nor MCP.md disclosed it. | barwise-xjf     |
| **Project validation skips the cross-domain rules off the CLI.** `barwise validate <manifest>` runs `projectRules`; `validate_model` validates each domain alone. A copy of `examples/auction-project` with one mapping pointed at a missing domain exits 1 on the CLI and passes on MCP. The editor checks a manifest's schema only.                                                                                                                            | barwise-0wa.qh3 |
| **Only CLI exports record lineage.** `barwise export` writes each artifact into `.barwise/lineage.yaml`; `export_model`, the VS Code Export... commands and `#barwiseExport` do not. The lineage tools on every surface read that manifest, so after an `export_model` call it had no entry for the artifact and the lineage tools could not see it.                                                                                                             | barwise-ace     |
| **Importing onto an existing file.** CLI `import transcript --output <existing>` merges; every other CLI importer overwrites with fresh ids. VS Code's transcript import shows a review dialog; its dbt and code imports overwrite `<name>.orm.yaml`. MCP's `import_model` only returns text.                                                                                                                                                                    | barwise-pks     |
| **The shipped bundles cannot run the gym.** `gym list` (CLI bundle) and `gym_list` (MCP bundle and the VS Code-embedded server) fail with a Node path error; both tsc builds work. The bundle harnesses run no gym command.                                                                                                                                                                                                                                      | barwise-fbi     |
| **The shipped bundles mint v4 ids.** The tsc builds and the VS Code extension host install the UUIDv7 generator; the three esbuild entries do not. Inside one editor, palette imports mint v7 and an external client of the embedded server mints v4.                                                                                                                                                                                                            | barwise-vqc     |
| **Deprecation notices point at nothing.** `barwise diagram` says to use `export --format svg`, which is not a registered format; `barwise schema` says to use `export --format ddl`. MCP and VS Code keep both as first-class, with no notice.                                                                                                                                                                                                                   | barwise-zir     |
| **An element name silently matches nothing in impact analysis.** `lineage impact --element Customer` and `impact_analysis` with `elementId: "Customer"` both report no affected artifacts; the same call with the element's id lists them. Already tracked for the CLI; the MCP tool has the same behavior.                                                                                                                                                      | barwise-5m9     |
| **The keyless failure is unexplained.** With no key and no Ollama server, CLI and MCP transcript import both fail with `fetch failed`.                                                                                                                                                                                                                                                                                                                           | barwise-ckt     |

## Gaps in reach the capability matrix does not mark

The matrix's rule is that an unmarked gap is a bug. These are unmarked. Each
issue asks for the gap to be closed or recorded as deliberate; this audit
decides neither.

| Gap                                                                                                                                                                                                                                                                                                      | Issue       |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **VS Code's pickers offer a subset of the formats.** Import... has no DDL, OpenAPI, NORMA or SQL; Export... has no OpenAPI or NORMA. They are reachable only through Copilot Chat. A DDL dialect is reachable on the CLI (`--dialect`) and MCP (`options.dialect`, undocumented) and nowhere in VS Code. | barwise-i22 |
| **Project and domain inputs differ by command.** CLI `review` takes no project; MCP `review_model` does. CLI `diagram` takes `--domain`; MCP `generate_diagram` does not. The VS Code review tool has no `domain` though the MCP tool it mirrors does.                                                   | barwise-rb4 |
| **Transcript-import options differ.** `--alternatives`: CLI and MCP. `--trail`: CLI only. Existing-model context for the extractor: MCP (`base`) and the VS Code chat tool, not the CLI or the palette. Only `--samples` has a matrix row.                                                               | barwise-6n8 |
| **Starting from nothing.** VS Code's **Barwise: New Project** writes a starter model; the CLI's `project init` writes an empty manifest only; MCP has no equivalent.                                                                                                                                     | barwise-c2e |

One more is a matter of definition rather than a gap. The matrix counts a
capability as reachable from VS Code when it is a palette command _or_ a
Copilot Chat tool. That is accurate, but a user without Copilot has no
`diff`, `merge`, `query`, `describe`, `review`, lineage, or DDL/OpenAPI/NORMA
import in the editor. The VS Code guide says so in its own words.

## Documentation that contradicted the code

Corrected in the same change as this audit:

- `docs/MCP.md` told every client to run `npx @barwise/mcp`. Every package is
  `"private": true` and npm returns 404 for `@barwise/mcp`, so a new user's
  first step failed. It also said the editor registers "seven tools" (it
  registers fourteen), told readers to use the CLI for dbt, Avro and OpenAPI
  export (`export_model` does all three), listed SQL as an export format (no
  SQL exporter is registered), and did not say that `merge_models` writes its
  base file.
- `packages/vscode/README.md` listed palette commands as `ORM: ...` (they are
  `Barwise: ...`, except **ORM: Analyze Repository**), said **New Project**
  scaffolds a `.orm-project.yaml` (it writes one `.orm.yaml`), and listed the
  deprecated key setting.
- `README.md` gave the VS Code floor as 1.93 (the extension declares
  `^1.101.0`) and listed the deprecated `barwise.anthropicApiKey` setting as
  the way to supply a key.
- `examples/README.md` walked through **ORM: Import Transcript**, **ORM:
  Validate Model**, **ORM: Verbalize Model** and **ORM: Show Diagram**, and
  output channels named `ORM ...`; none of those names exist.
- Root `CLAUDE.md` said the CLI's `project` command has `init`, `domains`,
  `mappings` and `split`; only `init` and `split` exist.

Still open:

- `docs/CLI.md` and `docs/MCP.md` omit options and parameters the code has,
  and MCP.md omits the `reasoning-trail://` resource (barwise-ntw).
- `test-plan/vscode-checklist.md` says the Export... picker lists OpenAPI; it
  does not (barwise-i22).
- `docs/IMPORT_EXPORT.md` (barwise-4hh, already tracked).

## Incidental findings

Found on the way; not surface-parity questions.

- **DDL export does not quote reserved words.** An entity named `Order`
  exports as `CREATE TABLE order` in every dialect (barwise-rck).
- **DDL import states a foreign key backwards.** The reading's role order is
  reversed from the fact type's name, so `verbalize` says "Customer references
  SalesOrder"; the inverse role is "is references by"; a column not named
  after the key becomes the verb ("SalesOrder customerNumber Customer")
  (barwise-ozl).
- **Junction tables do not round-trip.** `order_line` re-exports as
  `"sales_order,_product_and_quantity_order_line"`, and the Avro record name
  carries the comma, which Avro rejects (barwise-2oq).
- **barwise-cz6 looks superseded.** It asks for dbt and OpenAPI export on MCP;
  `export_model` does both. A note recommending closure was added.

## Negative results

Recorded so the coverage of this audit is visible.

- The seventeen tools the MCP server registers match the seventeen sections
  of MCP.md's tool reference, one to one.
- Every export format the registry has (`ddl`, `dbt`, `openapi`, `avro`,
  `norma`) exported the sample model with exit 0 from the CLI, and through
  `export_model` from the release bundle.
- On the same imported model, CLI `validate` and MCP `validate_model` agreed
  (0 errors, 1 warning), and `verbalize` and `verbalize_model` produced the
  same sentences.
- The VS Code chat tools are the MCP tools minus `analyze_repository`,
  `gym_list` and `gym_check`; the first is a palette command instead, and the
  gym's absence is marked deliberate in the matrix.
