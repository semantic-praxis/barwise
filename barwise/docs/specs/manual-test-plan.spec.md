# Manual test plan for the CLI, MCP, and VS Code surfaces

Status: Draft for review (harness prototyped and green; this spec records
the design)
Tracking: follow-up to the sensemaking program (PRs #160, #166, #167);
supports real-use bug hunting before wider adoption

## Principle

Barwise is one deterministic `@barwise/core` wrapped by three surfaces --
the `barwise` CLI, the `barwise-mcp` server, and the VS Code extension --
and orthogonality plus composability are the primary pillars. The unit
and integration suites verify each package in isolation, but they stop at
the package boundary: the MCP tool tests call handler functions directly
("no transport needed"), and the CLI tests invoke the program in-process.
Neither exercises the built bundle the way a user does, nor the seams a
user actually hits: real files, exit codes, stdout/stderr separation,
and whether the _same model_ yields the _same answer_ on every surface.
This plan covers that gap with a thin, real-use harness, and leans on
explicit-over-implicit by declaring its corpus and its LLM-gating rather
than discovering them at runtime.

## Should we script two surfaces and hand-check the third? (resolved: yes)

The three surfaces differ in kind, so one harness shape cannot fit all.
The CLI is a process with arguments and an exit code -- a shell script
asserts both directly. The MCP server is a stdio JSON-RPC peer -- a Node
script driving the official SDK client exercises the real transport, tool
dispatch, resources, and prompts. The VS Code extension is interactive
(webview, live diagnostics, chat) and resists scripting without a heavy
Extension-Host harness, which is out of proportion to a bug-hunting pass;
a manual checklist is the proportionate tool. The split is the surfaces'
nature, not convenience.

## Scope

In scope: a `barwise/test-plan/` directory holding `cli-checks.sh`,
`mcp-checks.mjs`, `vscode-checklist.md`, a `fixtures/` set, and a
`README.md`; plus the config exclusions that keep this tooling dir out of
the formatting, dead-code, and lint gates.

Out of scope: wiring the scripts into `ci.yml` as a required check (they
are written to be CI-capable, exiting non-zero on failure, but adding a
gate is a separate call); an automated VS Code Extension-Host harness;
performance benchmarking; and any change to the validations themselves
(those are specced in `external-uniqueness.spec.md`,
`cross-fact-type-counterexamples.spec.md`, and the sensemaking specs).

## Inventory

| Artifact                        | Role                                 | Verdict          |
| ------------------------------- | ------------------------------------ | ---------------- |
| `test-plan/cli-checks.sh`       | Drives the built CLI bundle          | new (executable) |
| `test-plan/mcp-checks.mjs`      | Drives the MCP server over stdio SDK | new (entry)      |
| `test-plan/vscode-checklist.md` | Manual interactive walkthrough       | new              |
| `test-plan/fixtures/*.orm.yaml` | Purpose-built models (see below)     | new              |
| `test-plan/README.md`           | How to run, fixtures, gating         | new              |
| `dprint.json` excludes          | Add `test-plan/**`                   | one line         |
| `knip.json` ignore              | Add `test-plan/**`                   | one line         |

The shipped `examples/` corpus is reused unchanged, so the checks double
as a regression test on the examples. The `validate --format json` output
is a diagnostics _array_ (not an object) and `review_model` is
LLM-powered; both surfaced during grounding and shaped the assertions.

## Target architecture

```
barwise/test-plan/
  README.md              How to run; fixtures; LLM-gating; binary overrides
  cli-checks.sh          BARWISE=<bin> ; asserts exit codes + key output
  mcp-checks.mjs         MCP_SERVER=<cmd> ; SDK client over stdio
  vscode-checklist.md    Manual: diagnostics, commands, webview, chat
  fixtures/
    external-uniqueness.orm.yaml            clean combination (0 errors)
    external-uniqueness-violation.orm.yaml  shared combination (1 error)
    constraints-showcase.orm.yaml           one of every constraint type
    broken.orm.yaml                         dangling reference (load error)

corpus reused: ../examples/** (clean models, auction-project, transcripts)
```

## Alternatives considered

- _Extend the vitest integration suites instead._ Rejected: they mock the
  MCP transport and run the CLI in-process, so they never see the bundle,
  the exit code, or real stdio framing -- exactly the seams a real-use
  pass must hit.
- _One unified harness across all three surfaces._ Rejected: bash, an MCP
  client, and an interactive editor have no common driver; forcing one
  would couple unlike things and bend each check away from its surface.
- _Invent a fresh fixture for every check._ Rejected: reusing `examples/`
  gives the checks regression value over the shipped corpus; only the
  cases the examples lack (external uniqueness, an all-constraints model,
  a deliberately broken model) are added.

## Workstreams (each independently shippable)

The four ship as one PR here because the harness is small and the config
exclusions are meaningless without the directory they exclude.

### 1. Fixtures

The four `fixtures/*.orm.yaml` models, each validated against the real
schema via the built CLI so the assertions rest on known-good inputs.

### 2. CLI harness

`cli-checks.sh`: smoke, validate (text/json/broken), verbalize and
counterexamples, every query command including `anchors`, every export
format, diagram, describe, diff, the external-uniqueness pair, project
split-and-validate, and an LLM-gated transcript import with `--trail`.

### 3. MCP harness

`mcp-checks.mjs`: discovery (tools, resource schemes, prompts), the core
tools, the external-uniqueness parity pair, the three resource schemes
including the `reasoning-trail://` fallback, a prompt render, and an
LLM-gated `review_model` / `import_transcript` section.

### 4. VS Code checklist + config + README

The manual walkthrough, the `dprint`/`knip` exclusions, and the README.

## API and migration impact

- No package code changes; nothing moves in or out of any workspace.
- `test-plan/` sits outside the workspaces, so `build`, `test`, and the
  per-package `eslint` do not touch it; `dprint` and `knip` are told to
  skip it explicitly.
- No downstream packages update; the one-way dependency graph is
  untouched.

## Open decisions (for review)

- **Wire the scripts into CI?** They exit non-zero on failure, so they
  could become a job in `ci.yml`. Recommend not yet: they drive the
  bundles (extra build cost) and the LLM-gated steps need a provider
  secret. Revisit once the harness has shaken out real bugs.
- **Where should `test-plan/` live?** A top-level tooling dir (chosen)
  keeps it discoverable and surface-agnostic. The alternative, per
  package, would fragment a cross-surface plan. Recommend keeping it
  top-level.
- **LLM checks: skip or fail when no provider?** Chosen: skip (reported,
  not counted as failure), so the harness is green offline. Recommend
  keeping skip; a missing key is an environment fact, not a defect.

## Risks and testing

- The harness must stay deterministic offline: every non-LLM check is a
  pure function of the committed fixtures and examples. The LLM-gated
  checks are the only non-deterministic part and are opt-in.
- Excluding `test-plan/` from `dprint` means its prose is not format-
  gated; acceptable for a tooling dir (precedent: `schemas/**`,
  `scripts/**`).
- Both scripts were run green against the current `main` build (CLI 26
  checks, MCP 16 checks, LLM steps skipped); `knip` stays clean with the
  ignore in place.

## Non-goals

- No new product capability and no change to any validation rule.
- No automated coverage of the VS Code surface; it stays a manual
  checklist by design.
- Not a replacement for the unit/integration suites; this is the
  real-use layer on top of them.
