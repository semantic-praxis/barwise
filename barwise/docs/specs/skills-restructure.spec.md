# Restructure skills, CLAUDE.md, and tool descriptions for Claude 5 context engineering

Status: Workstreams 1-4 implemented (PR #281, 2026-07-27): complete MCP
descriptions + slimmed barwise-modeling, compressed skill frontmatter,
deduped spec-writer with unknowns discovery, slimmed CLAUDE.md with the
release skill extracted. Open: WS5 (arch-review saved workflow),
provisional -- not yet grounded in a demonstrated need.
Created: 2026-07-27
Last-updated: 2026-08-07
Tracking: Claude 5 guidance articles -- "The new rules of context engineering
for Claude 5 generation models", "A field guide to Claude Fable 5: Finding
your unknowns", "A harness for every task: dynamic workflows in Claude Code"
(claude.com/blog, June-July 2026)

## Principle

The repo's context artifacts -- the four `.claude/skills/`, `CLAUDE.md`, and
the MCP tool descriptions -- were written under Claude 4-era assumptions:
models under-trigger skills (so descriptions enumerate trigger phrases),
instructions need repeating near the point of use (so the same guidance lives
in several places), and guardrail rules beat judgement (so sections shout
"STOP" and "never"). Anthropic's Claude 5 guidance retires each assumption:
tool instructions belong in tool descriptions with mirror copies deleted,
skills are lightweight opinion-encoding guides, CLAUDE.md spends its tokens on
gotchas rather than procedure, and rules survive only where a demonstrable
failure mode exists.

This is orthogonality applied to context: each instruction gets exactly one
home, and every other artifact points at it instead of restating it. Today the
context-hygiene guidance lives in three places (the `barwise-modeling` skill,
five tool descriptions, and `CONTEXT_HYGIENE_GUIDANCE` in
`packages/mcp/src/prompts/guidance/guidance.ts`), the doc-naming convention in
two (`CLAUDE.md` and the `spec-writer` skill), and the house spec structure in
two (`spec-writer`'s prose and its own `template.spec.md`). Duplicated
instructions drift, and drifted instructions are worse than absent ones.

## Should we keep guardrail-style rules at all? (resolved: only with a demonstrable failure mode)

The rules-to-judgement shift is not "delete every rule". The
context-engineering article's test:
would Claude get this right from the surrounding context and intent? Rules
that fail that test are load-bearing and stay -- reworded with their reason,
which generalizes better than a bare imperative:

- `gym-coach`'s "never edit the session log" guards the gym's output artifacts
  (the deterministic record is the product; a helpful edit destroys it).
- `CLAUDE.md`'s session-completion push requirement guards against a real
  remote-session failure mode (work stranded in an ephemeral container).

Rules that pass the test go: exhaustive trigger-phrase enumeration in
descriptions, all-caps emphasis, and hygiene rules that restate what a tool
description already says.

## Should we maintain model-class-specific skill versions? (resolved: no -- write once, degrade gracefully)

These skills are not used only by Claude 5-generation models: sessions,
subagents, and workflow stages may run Opus/Sonnet 4.x or Haiku 4.5, for
which the guardrail-era guidance still helps. Forked per-class variants are
the wrong remedy: the skill format has no model-conditional loading (the same
`SKILL.md` loads whichever model is running), so variants would need manual
selection, and two copies of every opinion recreates exactly the drift this
spec exists to remove.

Instead, write each skill once, to a form that serves both classes:

- **Rule with reason.** A stated rule plus its rationale is near-optimal for
  both: a 5-generation model reads the reason and generalizes; a 4.x model
  follows the rule. This is what the guardrail resolution above already
  prescribes -- the cut is shouting and repetition, not the rules themselves.
- **Progressive disclosure costs older models nothing.** Frontmatter-only
  loading and body-on-trigger are harness mechanics, independent of the
  model. Reference-file pointers ("read `editing.md` during the edit pass")
  are followed less reliably by 4.x models, so keep pointers few and place
  them at the point of need rather than in a preamble.
- **Descriptions are the one real tension.** 4.x models genuinely
  under-trigger, so stripping all triggering cues optimizes for one class at
  the other's expense. The resolution: compress, don't strip -- state what
  the skill provides, when to use it, and two or three representative
  contexts, dropping only the long verbatim phrase lists. Workstream 2 is
  scoped to this standard.

## Scope

In scope:

- When an MCP tool or resource can return large or truncated output, its
  registered description shall state the size behavior and name the focused
  alternative (`query_model`, `mode='summary'`, the returned file path).
- When a skill instruction mirrors guidance owned by a tool description, a
  template, or another skill, the skill shall replace the mirror with a
  pointer to the owner.
- When a skill frontmatter description is rewritten, it shall state what the
  skill provides, when to use it, and at most a few representative contexts,
  without exhaustive trigger-phrase lists.
- `CLAUDE.md` slimming: procedure moves to a skill; derivable history is cut;
  gotchas stay.
- One provisional saved workflow for the Phase A architecture review.

Out of scope: account-level skills under `~/.claude/skills/` (reviewed;
findings recorded below, but changes happen outside this repo); all package
source except MCP tool/resource description strings; any behavior change to
validation, verbalization, mapping, or the gym.

## Inventory

| Artifact                                | Current state                                                                    | Verdict                                                                     |
| --------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `.claude/skills/barwise-modeling`       | 60 lines; "Context hygiene" section duplicates tool descriptions + `guidance.ts` | slim: hygiene moves to tool descriptions, skill keeps workflow + delegation |
| `.claude/skills/spec-writer`            | 187 lines + 4 reference files                                                    | dedupe mirrors; add unknowns-discovery steps                                |
| `.claude/skills/articulation`           | 130 lines; taxonomy is a rubric                                                  | keep body; simplify description                                             |
| `.claude/skills/gym-coach`              | 87 lines; bias table is a rubric                                                 | keep body; simplify description                                             |
| `.claude/agents/*.md`                   | two subagent briefs                                                              | unchanged (worker primitives)                                               |
| `CLAUDE.md`                             | ~250 lines incl. release procedure, milestone history                            | slim to purpose + gotchas + pointers                                        |
| `packages/mcp/src/tools/*` descriptions | 5 of 17 carry partial size guidance; `describe_domain` omits its caps            | complete the size guidance                                                  |
| `packages/mcp/src/resources/*`          | `orm-model://` already carries full hygiene text                                 | unchanged                                                                   |
| `.claude/workflows/`                    | absent                                                                           | add `arch-review` (provisional)                                             |

Not affected: `CONTEXT_HYGIENE_GUIDANCE` in
`packages/mcp/src/prompts/guidance/guidance.ts` stays as-is -- it is the
canonical prose behind the MCP prompts (`analyze-domain`, `review-model`) and
the Copilot participant, which serve clients that never read our skills.

## Target architecture

```
CLAUDE.md                          what the repo is, gotchas, pointers
  -> skills/spec-writer            owns house spec format (via template.spec.md)
  |                                and the doc naming/dating convention
  -> skills/release        [new]   owns the version-bump + tag + release procedure
  -> skills/barwise-modeling       owns the modeling workflow + delegation
  |    -> MCP tool descriptions    own per-tool usage and output-size behavior
  |    -> mcp guidance.ts          canonical hygiene prose (feeds MCP prompts)
  -> skills/articulation           owns the barrier taxonomy (rubric)
  -> skills/gym-coach              owns the coaching rubric (bias table)
.claude/agents/*                   worker primitives (unchanged)
.claude/workflows/arch-review      Phase A scenario fan-out (provisional)
```

Each fact appears once; arrows are pointers, not copies.

## Alternatives considered

- **Delete the hygiene guidance everywhere and trust judgement.** Lost:
  truncation caps and file-spill behavior are interface facts, not judgement
  calls -- Claude cannot discover that `describe_domain` caps its arrays
  without first paying for a large call. The context-engineering article's own
  remedy is to put tool instructions in tool descriptions, not to delete them.
- **Fold `articulation` into `spec-writer`.** Lost: articulation serves
  audiences beyond specs (code, models, commit messages, reviews). Folding
  couples two orthogonal concerns and forces spec-writer to load for
  non-spec work.
- **One big-bang PR.** Lost: the description edits touch the mcp package
  (build + test) while the skill and `CLAUDE.md` edits are docs-only; separate
  PRs keep each reviewable and independently revertable.
- **Keep the milestone history in `CLAUDE.md`.** It is derivable from git tags
  and `docs/`; the guidance is to avoid stating what Claude can look up, and
  every session pays its token cost.

## Workstreams (each independently shippable)

### 1. Complete MCP descriptions, slim barwise-modeling

Add the missing size guidance to tool descriptions: `describe_domain` gains
its length-cap note ("arrays are length-capped; follow up with query_model on
truncation"), `merge_models` gains a note that it returns the full merged YAML
inline, and `verbalize_model`'s existing note is sharpened to summary-first.
No test pins any description string (`serverSpawn.test.ts` asserts tool names
only), so this is a description-only change plus a rebuild. Then the skill's
"Context hygiene" section shrinks to two sentences: delegate heavy operations
to the two subagents, and trust the tool descriptions for per-tool size
behavior. The workflow section and canonical-reference pointer stay.

### 2. Compress skill frontmatter descriptions

Rewrite all four descriptions to state what the skill provides, when to use
it, and two or three representative contexts. Drop the exhaustive phrase lists
("Trigger on 'articulation review', 'is this clear', 'tighten this up', ...")
-- Claude 5 models trigger on meaning, and long lists cost tokens in every
session's skill listing. Keep a few representative contexts because 4.x-class
models still under-trigger (see the model-class resolution above); compress,
don't strip.

### 3. Dedupe spec-writer, add unknowns discovery

Dedupe: the "House structure" section becomes a pointer to
`template.spec.md`; the doc naming/dating convention stays here and shrinks to
one line in `CLAUDE.md`; the double articulation invocation (workflow step 6
and `editing.md` pass 7) collapses to one reference; the pre-push gate keeps
its checklist but drops the all-caps framing in favor of the reason (a design
change invalidates formatting work).

Add, from the Fable field guide: an interview step before drafting ("interview
the requester one question at a time about ambiguities; prioritize questions
whose answer changes the architecture"), feeding the Open decisions section;
and a note that implementation PRs keep an implementation-notes record of
deviations from the spec, which feeds the next spec revision.

### 4. Slim CLAUDE.md, extract a release skill

Move the version-bump/tag/release procedure (including the
`--no-workspaces-update` sequence and the GitHub release commands) into a new
`release` skill. The gotchas stay in the skill with the procedure they guard:
the internal `@barwise/*` dependency-ref rewrite, the pinned `SERVER_VERSION`
sync test, and the `regen:tutorial` drift test. `CLAUDE.md` keeps: what the
repo is, the design principles, the dependency graph, the monorepo commands,
conventions, and one-line pointers to the skills. Cut: the Milestones section
and most of Current State (derivable from git tags and docs). The Session
Completion and beads sections stay but are reworded with their reasons (see
Open decisions).

### 5. Add an arch-review saved workflow (provisional: not yet grounded)

A `.claude/workflows/arch-review` script for the Phase A review: fan out one
agent per scenario in `docs/architecture-scenarios.md`, adversarially verify
each finding, and synthesize a ranked draft for the next dated
`REPO_REVIEW-<date>.md`. This replaces prose orchestration with a script per
the workflows article. Ground it against the actual scenario catalog and
`architecture-analysis.spec.md` before implementing.

## API and migration impact

- No public API changes. MCP tool descriptions are client-visible strings;
  clients see new text, no schema or name changes.
- Blast radius: workstream 1 rebuilds `@barwise/mcp` only; workstreams 2-5
  touch no package source.

## Open decisions (for review)

- **Session Completion / beads sections in `CLAUDE.md`.** Options: keep
  verbatim; keep but reword with reasons and without all-caps; move to a
  skill. Recommend keep-reworded: the push requirement guards a real remote-
  session failure mode, but a skill would not reliably load at session end.
- **Release procedure home.** Options: a `release` skill (loads only when
  releasing) or `docs/RELEASING.md` (plain doc, no skill machinery). Recommend
  the skill: the procedure is something Claude executes, and progressive
  disclosure is the point.
- **Run `claude doctor` as an input to workstream 4.** The article ships an
  automated rightsizing check. Recommend yes, advisory only -- its output is
  reviewed against this spec, not applied blindly.
- **Timing of workstream 5.** The workflow is useful but new machinery.
  Recommend landing it last, after the deduplication workstreams prove out.

## Risks and testing

- After workstream 1, run the mcp package tests; `serverSpawn.test.ts` and
  `prompts/guidance.test.ts` are the nearest assertions and neither covers
  description strings.
- Skills have no automated tests; the risk is behavioral regression in future
  sessions. Mitigation: workstreams are small, reviewable diffs, and cuts are
  limited to text that is demonstrably owned elsewhere.
- No version bump in any workstream, so the `SERVER_VERSION` sync test and the
  tutorial drift test are unaffected.
- `npm run fmt` after every markdown edit; the pre-commit hook enforces it.

## Non-goals

- No semantic changes to the barrier taxonomy, the reductive-bias catalog, or
  the modeling workflow -- this spec moves and trims text, it does not revise
  the opinions the skills encode.
- No MCP tool renames, schema changes, or new tools.
- No edits to account-level skills from this repo (findings below).

## Out-of-repo findings: account-level skills (informational)

Recorded here because this review covered them; acting on them is outside
this repo. All three live in the user's `~/.claude/skills/`.

- **skill-forge.** Contains the advice the context-engineering article
  retires: "Models under-trigger skills, so lean pushy: enumerate trigger
  phrases" -- and its own description does exactly that. Phase 7
  (description optimization) should optimize for precision, not pushiness.
  Its Phase 3-4 executor/grader fan-out is a dynamic workflow written as
  prose; the workflows article names skill evals as a workflow use case and
  documents shipping workflow scripts inside a skill as templates. Also
  overlaps the installed `skill-creator` (485 lines, same domain) -- two
  skills competing to trigger on the same requests; keep one. Much of it is
  already aligned (explain-why-not-just-what, the judgment/mechanism split,
  progressive disclosure).
- **sensemaking.** Already the strongest example of the new guidance: the
  verification-log format is a rich reference, thresholds are explicit, and
  theory lives in a `references/` file. Trim the trigger-phrase description.
  One addition worth making: several of the workflows article's example
  prompts are sensemaking-shaped ("form competing theories about the race,
  and don't stop until one theory survives the evidence"; root-cause agents
  fed disjoint evidence, judged by verifier/refuter panels). Workflows are
  the structural mechanism for the skill's step 5 -- competing frames with
  discriminating tests -- and context isolation is what prevents frame
  fixation (the article's "self-preferential bias"). A short section could
  say: for high-blast-radius investigations, run the frame competition as a
  dynamic workflow, one agent elaborating each frame from disjoint evidence,
  a refuter panel judging, and commit to the surviving frame.
- **writing-conventions.** EDPL-team document conventions whose description
  fires for "any markdown document" -- over-broad in this workspace, where it
  competes with the barwise house spec format. Scope its description to EDPL
  outputs (it is already `user-invocable: false`, the right pattern for a
  context-only skill). It also uses emoji, which the barwise repo bans;
  irrelevant to EDPL outputs but worth knowing when it loads here.
- The repo's `spec-writer` bundles its own condensed `sensemaking.md` rather
  than depending on the account skill. That duplication is correct and stays:
  the repo cannot assume contributors have the account skill installed, and
  DRY is secondary to that decoupling.
