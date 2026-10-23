# Review instructions for barwise

This file is read by the Claude Code Review service when an Owner has
enabled it for this repository -- always the copy on the default
branch, never the one a pull request changes -- and by the `pr-review`
checklist, which runs the failure modes below on every PR. It owns two things: which review runs when, and the
defects reviews here keep finding. Project rules live in `CLAUDE.md`
(the service reads that too); the invariants grouped by what a diff
touches live in `.claude/skills/pr-review/checklist.md`. Do not copy
either into this file; point at them.

Design and evidence: `barwise/docs/specs/review-md.spec.md`.

## Which review runs when

| Lane               | Run by                          | When                                                      | Reads this file        |
| ------------------ | ------------------------------- | --------------------------------------------------------- | ---------------------- |
| CI (`ci.yml`)      | GitHub and the pre-push hook    | Every push                                                | no                     |
| `/code-review`     | The author                      | Before opening: `high` on the spine, `low` on the fallout | no; reads `CLAUDE.md`  |
| `/security-review` | The author                      | Before opening, when a trigger below is in the diff       | no                     |
| Claude Code Review | GitHub                          | Every PR, once an Owner enables the service               | yes                    |
| `/pr-review`       | The PR's agent, or anyone asked | Before merging, on the head being merged (`steward` 4b)   | yes, via its checklist |

`/pr-review` runs `/code-review` itself as its correctness engine, so the
author's earlier run is not a substitute for it; it is what keeps the
first review from finding what the author could have found alone.

Run `/security-review` when the diff:

- makes a network call (the LLM providers in `@barwise/llm`, any
  `fetch`);
- starts a subprocess or builds a command line (`dbt compile`, the LSP
  sessions in `@barwise/code-analysis`, anything under `barwise/scripts/`
  that calls `execFileSync` or `spawnSync`);
- reads or writes a file whose path comes from input (MCP tools that
  read or write back to a model file, exporters, `project split`);
- touches a workflow, especially a `pull_request_target` job such as
  `.github/workflows/copilot-review.yml`, or anything that handles a
  token, an API key, or `ExtensionContext.secrets`;
- puts text from a transcript, a model file, or an imported schema into
  an LLM prompt whose output is then written or executed.

## What each severity means here

**Important** is for a defect that makes barwise give a wrong answer
while reporting success, or that weakens a check the project relies on:

- input or model content lost with exit 0 and no diagnostic;
- a gate, check, or script that can report a pass when it could not read
  its input;
- a test that cannot fail on the defect it says it guards;
- non-determinism (clock, randomness, I/O, network) entering
  `@barwise/core`;
- a credential in the diff, or a workflow that runs pull-request code
  with a write token;
- a behaviour the PR description claims and the code does not have (the
  description is part of the change here: reviewers and the next session
  trust it);
- a violation of a rule `CLAUDE.md` states as "never" or "must".

**Nit** is for everything a reader could live with: wording, naming, a
comment that is slightly off but misleads nobody. Report at most five
Nits per review, and report a given rule once per PR rather than once per
line (a spec once drew the same "write this in EARS form" request seven
times).

**Pre-existing** is for a defect on lines this PR did not change, or one
already on `main`. Say so; do not present it as the PR's.

## Evidence a finding needs

Each rule here comes from a finding an author rebutted with a reason.

- Name the input or state that triggers it, and the `file:line` where it
  goes wrong. A behaviour claim cites the source, not an inference from a
  name.
- Before flagging how one site handles a convention (case folding,
  quoting, id format), check whether the module does the same everywhere.
  If it does, the finding is about the module, not the PR, and is
  Pre-existing at most (#625: one quoted-name fix would have made the
  importer inconsistent with itself).
- Do not re-raise a decision the PR description or its spec already
  records -- a Non-goal, an Open decision, a measured trade-off -- unless
  you cite code that contradicts the stated reason (#662, #570).
- Quote the function, option, or line you are reasoning about. Two
  dismissed findings were about a filter that did not exist and a claim
  on a line that did not contain it (#672, #534).
- A performance or cost concern needs a reason to believe it matters at
  barwise's scale, not just the existence of a loop (#672: a measured
  35 ms).
- On a re-review after a push, raise new Nits only on lines the push
  changed. A defect the earlier review missed in this PR's own code is
  still the PR's, at its real severity; Pre-existing stays reserved for
  code already on `main`. Reviews that kept surfacing new Nits on
  unchanged code ran 10 to 13 rounds on #621 and #662.

## Do not report

- Anything CI already enforces: formatting (`fmt:check`), lint (ESLint,
  oxlint), type errors (the build), package boundaries and core purity
  (`depcruise`, `purity`), registered must-agree copies and the
  duplication ratchet (`check:parity`, `audit:duplication`), tracker
  validity and issue closures (`check:beads`, `check:tracker-closes`),
  paths cited by instruction files (`check:instruction-refs`), secrets
  (`check:secrets`), Python invocation (`check:python-uv`), and spec
  status claims (`audit:specs`). The full list is `ci.yml`.
- Regenerated output. Review the generator instead, and flag the output
  only if it changed with no change to its generator or source:
  `builtins.generated.ts`, `barwise/examples/output/`,
  `barwise/docs/tutorial/`, the CLI goldens under
  `barwise/packages/cli/tests/characterization/golden/`, the diagram-ui
  goldens, and the reference models the `regen:references` script writes.
- Recorded data: `barwise/eval-runs/`, `barwise/eval-payloads/`,
  `barwise/trial-baseline.json`, `package-lock.json`, and
  `.beads/issues.jsonl` -- except a count or status there that
  contradicts the PR description.

## Always check: the failure modes of the last month

Ranked by how often they recurred between 2026-09-23 and 2026-10-23 and
what they cost. Each is something a reader can see in the diff and the
code around it. Run them on every PR, then the groups of
`.claude/skills/pr-review/checklist.md` whose trigger the diff meets.

1. **Input dropped at a boundary with exit 0.** In an importer, exporter,
   loader, serializer, mapper, or CLI argument parser, every branch that
   skips something -- `continue`, an early return, a regex that does not
   match, a fixed skip-list -- either emits a diagnostic or refuses. Look
   for `a ?? b` where both can be present, `find` where several can
   match, `null` or `""` reaching a default, and an empty list that means
   "all". This class had the longest-lived defects of the month:
   `import sql` dropped every unreferenced table (c3e8bd75), no exporter
   recorded lineage sources for months (b0f408dc), entity
   fields were lost on save for five weeks (aaf5837c), and code importers
   skipped any class named `Event` or `Result` (barwise-tn4).
2. **A gate or script answers without seeing its input.** Under
   `barwise/scripts/`, a read, parse, subprocess, or empty-input failure
   exits 2 (could not answer), never 0 or 1, and never `continue`s past
   it (`CLAUDE.md`, "A gate that cannot see its input must not print
   PASS"). Flags are parsed, not read by position; the repository root
   comes from `git rev-parse --show-toplevel`, not the working directory;
   `execFileSync` on output that can grow sets `maxBuffer`. Instances:
   `at-root.mjs` forwarding a literal `--` so a `--write` silently did
   nothing (9edc13c9), a trial grading `lineage impact` on exit code alone
   so 128 checks passed over a broken feature (01f7fa66), an empty filter
   printing "OK -- 0 files" (2e101af6), a 1 MiB buffer limit on the
   tracker (179f405d).
3. **A test that cannot fail.** The expected value is not computed by the
   code under test; a fixture has the shape the real producer emits; a
   refusal test asserts the message, not only the exit code; an assertion
   reads a key that exists. Instances: an assertion on a renamed key that
   could never fail (e72027be), fixtures in a shape the CLI never emits
   (b0ec692c), eight of 24 refusal tests that still passed with the
   refusal disabled (barwise-1049).
4. **Wired in one place but not its siblings, or not at all.** Startup or
   side-effect code added to one entry point belongs in all of them
   (`barwise/packages/cli/src/bundle-entry.ts`,
   `barwise/packages/mcp/src/bundle-entry.ts`,
   `barwise/packages/vscode/src/mcp/stdio-entry.ts`; barwise-vqc). A step
   added to a CLI command has a counterpart in the MCP tool and in
   `barwise/packages/vscode/src/mcp/ToolRegistration.ts`, and the
   capability matrix checks reach, not behaviour (barwise-1fr). A fix to
   one importer is checked against the DDL, dbt, and OpenAPI siblings
   (74a71ad3: OpenAPI kept a constraint-role defect DDL had fixed). A new exported function has a non-test caller, and a new
   `package.json` script has a CI step (da360d7e: two vscode type-checks
   ran nowhere and were red on `main` for about a month).
5. **A restated fact went stale.** Beyond the checklist's "write each
   fact once": a user-facing message that names a format, command, or
   flag names one that is registered; setup docs name packages that are
   published (941cc09b); an MCP tool or VS Code language-model tool
   description matches what the tool does, because a model acts on it
   (43dfe061: `merge_models` said it returned YAML while it overwrote
   the base file).
6. **Parsers and boundary text.** SQL and identifier handling copes with
   quoted identifiers, case, doubled quotes, statements inside string
   literals, and same-named tables in different schemas (5aaf1fde,
   18a6a8a1, barwise-yvx).
7. **ORM shape assumptions.** Loops over a fact type's roles handle unary
   and n-ary fact types, not only binary (bb9b4660: n-ary roles were not
   exported). A random element id comes from `generateId` and a deterministic one
   from `derivedId`; neither is assembled from names by hand (35ee5c4a:
   three importers built role ids that collided), and
   a constructor and the mutator that adds the same element establish the
   same invariants (barwise-nkq).
8. **PR description claims.** Each claim about what the code does matches
   the code. #577 said a scanner blanked string literals when it blanked
   only comments (barwise-tms). Barwise PR descriptions carry a reading
   guide that splits the diff into spine and fallout; a changed file the
   guide does not account for is a question for the author.
