# Review instructions for barwise

**Failure here looks like a wrong answer reported as success**: a model
import that drops a table and exits 0, a gate that prints PASS over
input it could not read, a test that cannot fail. Look for that first.

This file is read by the Claude Code Review service once an Owner
enables it (always the default branch's copy, never the PR's), and by
the `pr-review` checklist, which runs the failure modes below on every
PR. It owns which review runs when and the defects reviews here keep
finding. Project rules are in `CLAUDE.md`; the invariants grouped by
what a diff touches are in `.claude/skills/pr-review/checklist.md`.
Evidence for every rule: `barwise/docs/specs/review-md.spec.md`.

## Which review runs when

| Lane               | Run by                          | When                                                      | Reads this file        |
| ------------------ | ------------------------------- | --------------------------------------------------------- | ---------------------- |
| CI (`ci.yml`)      | GitHub and the pre-push hook    | Every push                                                | no                     |
| `/code-review`     | The author                      | Before opening: `high` on the spine, `low` on the fallout | no; reads `CLAUDE.md`  |
| `/security-review` | The author                      | Before opening, when a trigger below is in the diff       | no                     |
| Claude Code Review | GitHub                          | Every PR, once an Owner enables the service               | yes                    |
| `/pr-review`       | The PR's agent, or anyone asked | Before merging, on the head being merged (`steward` 4b)   | yes, via its checklist |

`/pr-review` runs `/code-review` itself; the author's earlier run does
not replace it.

Run `/security-review` when the diff makes a network call (the LLM
providers, any `fetch`); starts a subprocess or builds a command line
(`dbt compile`, the LSP sessions in `@barwise/code-analysis`,
`execFileSync` or `spawnSync` in `barwise/scripts/`); reads or writes a
file whose path comes from input (MCP tools, exporters, `project
split`); touches a workflow (above all a `pull_request_target` job such as
`.github/workflows/copilot-review.yml`), a token, an API key or
`ExtensionContext.secrets`; or puts transcript, model or schema text
into an LLM prompt whose output is written or executed.

## The summary

The service's summary starts with the count of findings by severity,
and when there is nothing to fix says so in one sentence. (`/pr-review`
keeps its own five-part shape, its section 5.)

## What each severity means here

**Important**: barwise gives a wrong answer while reporting success, or
a check the project relies on gets weaker.

- Input or model content lost with exit 0 and no diagnostic.
- A gate, check or script that can pass when it could not read its input.
- A test that cannot fail on the defect it says it guards.
- Non-determinism (clock, randomness, I/O, network) entering
  `@barwise/core`.
- A credential in the diff, or a workflow that runs PR code with a write
  token.
- A behaviour the PR description claims and the code does not have.
- A break of a rule `CLAUDE.md` states as "never" or "must".

**Nit**: anything a reader could live with. At most five per review, and
one per rule per PR, not one per line. Most authors here are agents, and
an agent fixes every nit, so each one costs a commit and a review round.

**Pre-existing**: a defect in code already on `main`. Code this PR added
in an earlier push is still the PR's, at its real severity.

## Evidence a finding needs

Each rule here comes from a finding an author rebutted with a reason.

- The input or state that triggers it, and the `file:line` where it goes
  wrong. Quote the code you are reasoning about; a claim inferred from a
  name is not evidence (#672 and #534 were about a filter that did not
  exist and a line that did not say what was claimed).
- If the module handles a convention (case folding, quoting, ids) the
  same way everywhere, the finding is about the module, not the PR
  (#625): Pre-existing for sites on `main`, and for a new site that
  copies the convention, one finding that names the module-wide pattern
  rather than blaming this PR's line.
- Do not re-raise a decision the PR description or its spec records --
  a Non-goal, an Open decision, a measured trade-off -- unless you cite
  code that contradicts its stated reason (#662, #570).
- A performance concern needs a reason it matters at barwise's scale
  (#672: a measured 35 ms).

## Re-reviews must converge

Reviews here ran 10 to 13 rounds (#621, #662) and once 28 (barwise-q93),
mostly on code that had been there since the first pass.

- Name the class, not the instance: when one site has a defect, list
  every site in the diff with it in the same finding, so the author
  fixes them in one push.
- Do not post a finding twice. One already posted and still unfixed is
  listed once in the summary as still open, never dropped.
- After the first review, raise new Nits only on lines changed since the
  last one. Important findings in the PR's own code are raised wherever
  they are.
- From the third review on, report Important findings only, and if they
  are still arriving, say the approach may need rethinking rather than
  another round of fixes. An agent driving its own PR stops sooner: after
  two reviews that do not recommend `merge`, it asks the owner
  (`steward` 4b).

## Do not report

- What CI enforces: formatting, lint, types, package boundaries and core
  purity, registered copies and the duplication ratchet, tracker
  validity and closures, instruction-file paths, secrets, Python
  invocation, spec status claims. `ci.yml` is the list.
- Regenerated output, unless it changed with no change to its generator
  or source: `builtins.generated.ts`, `barwise/examples/output/`,
  `barwise/docs/tutorial/`, the CLI and diagram-ui goldens, and the
  reference models `regen:references` writes. Review the generator.
- Recorded data: `barwise/eval-runs/`, `barwise/eval-payloads/`,
  `barwise/trial-baseline.json`, `package-lock.json`,
  `.beads/issues.jsonl` -- except a count or status that contradicts the
  PR description.

## Always check: the failure modes of 2026-09-23 to 2026-10-23

Ranked by recurrence and cost. Run these on every PR, then the
checklist groups whose trigger the diff meets.

1. **Input dropped at a boundary.** In an importer, exporter, loader,
   serializer, mapper or argument parser, every branch that skips
   something (`continue`, early return, regex miss, fixed skip-list)
   emits a diagnostic or refuses. Watch `a ?? b` where both can be
   present, `find` where several match, `null` or `""` reaching a
   default, and an empty list meaning "all". The month's longest-lived
   defects: `import sql` dropped unreferenced tables (c3e8bd75), exports
   recorded no lineage sources for months (b0f408dc), entity fields were
   lost on save for five weeks (aaf5837c), and code importers skipped any
   class named `Event` or `Result` (barwise-tn4).
2. **A gate answers without seeing its input.** Under
   `barwise/scripts/`, a failed read, parse or subprocess, or an empty
   input, exits 2, never 0 or 1 and never `continue`. Flags are parsed,
   not read by position; the root comes from `git rev-parse
   --show-toplevel`; `execFileSync` on growing output sets `maxBuffer`
   (9edc13c9, 01f7fa66, 2e101af6, 179f405d).
3. **A test that cannot fail.** The expected value is not computed by the
   code under test; fixtures have the shape the real producer emits; a
   refusal test asserts the message, not only the exit code; an
   assertion reads a key that still exists (e72027be, b0ec692c; barwise-1049 found 8 of 24 refusal tests passing with the
   refusal disabled).
4. **Wired in one place, not its siblings.** Startup or side-effect code belongs in all
   three bundle entries (`barwise/packages/cli/src/bundle-entry.ts`,
   `barwise/packages/mcp/src/bundle-entry.ts`,
   `barwise/packages/vscode/src/mcp/stdio-entry.ts`; barwise-vqc). A step
   added to a CLI command has its MCP and
   `barwise/packages/vscode/src/mcp/ToolRegistration.ts` counterparts;
   the capability matrix checks reach, not behaviour (barwise-1fr). A fix to one importer is checked in the DDL, dbt and
   OpenAPI siblings (74a71ad3). A new export has a non-test caller; a
   new `package.json` script has a CI step (da360d7e).
5. **A restated fact went stale.** A message naming a format, command or
   flag names a registered one; docs name published packages
   (941cc09b); an MCP or language-model tool description matches what
   the tool does, because a model acts on it (43dfe061).
6. **Boundary text.** SQL and identifier handling copes with quoting,
   case, doubled quotes, statements inside string literals, and
   same-named tables in different schemas (5aaf1fde, 18a6a8a1,
   barwise-yvx).
7. **ORM shape.** Loops over roles handle unary and n-ary fact types, not
   only binary (bb9b4660). Random ids come from `generateId` and
   deterministic ones from `derivedId`, never assembled from names
   (35ee5c4a); a constructor and its mutator establish the same
   invariants (barwise-nkq).
8. **PR description claims.** Each claim about the code matches it
   (barwise-tms). Barwise PR descriptions carry a reading guide that
   splits the diff into spine and fallout; a changed file it does not
   account for is a question for the author.
