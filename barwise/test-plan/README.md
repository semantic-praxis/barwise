# Barwise manual test plan

A real-use, bug-hunting shakedown of the three barwise surfaces. The
unit and integration suites already cover the internals; this plan targets
what they don't reach -- real files, real I/O, exit codes, cross-surface
consistency, and the sensemaking features (counterexamples, anchors,
reasoning trail, external uniqueness).

| Surface | Harness | Run |
| ------- | ------- | --- |
| CLI (`barwise`) | `cli-checks.sh` | `test-plan/cli-checks.sh` |
| MCP server (`barwise-mcp`) | `mcp-checks.mjs` | `node test-plan/mcp-checks.mjs` |
| VS Code extension | `vscode-checklist.md` | manual walkthrough |

## Prerequisites

Build the bundles the harnesses drive (run from `barwise/`):

```sh
npm run build
npm run --workspace=@barwise/cli bundle
npm run --workspace=@barwise/mcp bundle
```

Both scripts exit non-zero if any check fails, so they can also gate CI.

## Fixtures

`fixtures/` holds purpose-built models the shipped `examples/` don't cover:

- `external-uniqueness.orm.yaml` -- Room identified by Building + RoomNumber
  (the WS4c cross-fact-type pattern), clean population.
- `external-uniqueness-violation.orm.yaml` -- same, but two rooms collide on
  the combination (validation reports the violation).
- `constraints-showcase.orm.yaml` -- one of every constraint type; the
  counterexample workhorse.
- `broken.orm.yaml` -- a dangling object-type reference, for the error path.

The rest of the corpus is the repo's own `examples/` (clean models, a
multi-domain `auction-project`, transcripts) so the checks double as a
regression test on the shipped examples.

## LLM-gated checks

The transcript-import (`import_transcript`, `barwise import transcript`) and
`review_model` checks call a real LLM. They run only when a provider is
configured (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `OLLAMA_HOST`);
otherwise they are skipped, not failed.

## Overriding the binaries

- CLI: `BARWISE="barwise" test-plan/cli-checks.sh` (or
  `BARWISE="node packages/cli/dist/index.js"`).
- MCP: `MCP_SERVER="barwise-mcp" node test-plan/mcp-checks.mjs`.

## Reporting bugs

Capture each finding as: **modality / command-or-tool / input fixture /
expected / actual / exit code or error**. The fixtures here make inputs
reproducible -- reference them by path.
