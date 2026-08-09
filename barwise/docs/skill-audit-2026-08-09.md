# Skill and subagent audit

Date: 2026-08-09
Scope: `.claude/skills/` (articulation, barwise-modeling, gym-coach,
release, spec-writer + its four reference files) and `.claude/agents/`
(barwise-transcript-extractor, barwise-model-reviewer). Method: the
prompt-audit discipline -- classify every instruction as context vs
constraint, verify volatile factual claims against the code, flag dated
patterns, propose diffs without applying them (except F1, a broken
config fixed in this PR). Companion measurement:
`docs/agent-eval-2026-08-09.md`.

## Overall verdict

This surface is clean. The skills are recent, carry their reasons
inline, state rules positively, and contain none of the usual dated
patterns (no pressure-language walls, no model-version workarounds, no
scaffolding that current models make redundant). Every volatile factual
claim checked out against the code (F6). The real findings are two
functional gaps -- a broken MCP registration that silently disabled
both subagents in remote sessions (F1), and a missing revise step in
the extractor agent (F2) -- both surfaced by measurement, not by
reading.

## Findings

### F1 (high, FIXED in this PR): `.mcp.json` could not start the barwise server anywhere but the maintainer's machine

Two independent breakages:

- The root `.mcp.json` pinned `"cwd": "/Users/gschenz/repos/barwise"`
  -- a machine-specific absolute path, so the server never registered
  in any other environment.
- Both `.mcp.json` files pointed at
  `packages/mcp/dist/bundle/index.cjs`, which only `npm run bundle`
  produces; the standard `npm run build` (what CI and session-start
  hooks run) does not create it.

Consequence: in remote sessions the `barwise-transcript-extractor` and
`barwise-model-reviewer` subagents ran with none of their MCP tools --
all eight measurement runs in the companion report found
`import_transcript` / `validate_model` / `query_model` unavailable.
The agents' core loop was dead weight outside the maintainer's laptop.

Fix applied: both files now run `node .../dist/bundle-entry.js` (the
tsc-built entry the esbuild bundle wraps; verified to start and hold
stdio open after a plain build) with no `cwd` pin. The `bin` entry for
npx/standalone use keeps pointing at the bundle, unchanged.

### F2 (high, proposed): the extractor agent validates but never revises

`agents/barwise-transcript-extractor.md` step 4 reads "Call
`validate_model` on the written file and note any errors." The agent
reports errors; nothing tells it to fix them. The whole advantage of
the agentic surface over single-shot `processTranscript` is the
validate-and-revise loop -- and the loop is left open at the revise
step.

Measurement evidence (companion report): a Fable 5 extraction scored
0.000 solely because of a schema conditional its manual self-check
missed (an entity subtype without `reference_mode`); one revise cycle
against the real validator output repaired it. Proposed diff:

```diff
-4. Call `validate_model` on the written file and note any errors.
+4. Call `validate_model` on the written file. If it reports errors,
+   fix them in the YAML and re-validate -- repeat until clean or three
+   cycles, whichever comes first. Note anything still failing.
```

And in the response format section:

```diff
-- Validation result: pass, or the count and a one-line summary of errors.
+- Validation result: pass, or what still fails after revision (count
+  and a one-line summary).
```

### F3 (low, proposed): no guidance for tool-unavailable sessions

When the MCP tools are absent (F1's world), the extractor agent has no
instructed behavior; in measurement, both models improvised a sensible
fallback (author the model directly, self-check against the schema) and
said so clearly. With F1 fixed this path should be rare, but one line
makes the behavior deliberate instead of improvised:

```diff
+If the barwise MCP tools are unavailable in the session, say so in
+your summary and stop after writing your best manual extraction --
+do not silently present unvalidated output as validated.
```

### F4 (low, proposed): spec-writer's interview step assumes a live requester

`spec-writer/SKILL.md` step 2 ("Interview away the ambiguities ... one
question at a time") has no path for autonomous sessions, where no
requester can answer and the step would block. Proposed addition:

```diff
+   In an autonomous session with no requester available, skip the
+   interview: state the assumptions you would have asked about, and
+   carry each one into Open decisions instead of resolving it silently.
```

### F5 (flag only): em-dash style inconsistency

`spec-writer/llm-tics.md` documents the house em-dash as `--`, and most
skills comply; `articulation/SKILL.md` uses typographic em-dashes
throughout. Cosmetic, and articulation is not a spec -- flagged for
consistency only, no diff proposed.

### F6 (verification, clean): volatile factual claims all current

Checked against the working tree: `npm run` scripts `regen:tutorial`,
`arch:triage`, `depcruise`, `purity`, `fmt`, `fmt:check` all exist;
`SERVER_VERSION` lives at `packages/mcp/src/server.ts:20`;
`docs/specs/archive/architecture-analysis.spec.md`,
`docs/architecture-scenarios.md`, and
`packages/mcp/src/prompts/guidance/guidance.ts` all exist; the gym
session log is tab-separated as gym-coach describes
(`packages/cli/src/commands/gym.ts:196-198`). The release skill's
remote-session note (no `gh` CLI, use the GitHub MCP tools) matches
this environment.

## What was deliberately not flagged

Per the audit's keep-list: the skills' length is context, not cruft --
audience contracts, failure-mode catalogs, and gotcha lists are exactly
the knowledge only the author has. The `barwise gym check` /
miss-card mechanics in gym-coach, the release bump gotchas, and the
sensemaking discipline all stay as-is. An audit that finds nothing to
delete on a well-kept surface should say so rather than manufacture
findings; F2-F4 are additions, not deletions.

## Eval-hygiene follow-up (for the workstream 6 runner)

During measurement, one agent consulted the checked-in answer key
(`*.reference.orm.yaml` sits in the same directory tree the agent
browses) while checking schema conventions; the run was discarded and
re-run with an explicit prohibition. When workstream 6 gets a real
headless runner, isolate the graded materials from the agent's view
(worktree without `evals/`, or an explicit denylist in the runner's
prompt) rather than relying on instruction alone.
