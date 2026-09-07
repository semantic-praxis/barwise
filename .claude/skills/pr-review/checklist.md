# Checklist: the barwise invariants CI cannot check

Everything `npm run ci:local` runs is excluded here by construction;
`.github/workflows/ci.yml` owns that list and CI will report it. What
remains is judgment, grouped by what the diff touches. Run the groups
whose trigger is present, skip the rest, and say in the review which
groups ran. Each item is a test to apply, followed by the authority it
comes from. This file is the single owner of these items: the
`pr-review` skill runs it and the `pr-creation` skill treats it as the
output specification for the PR body (spec:
`docs/specs/pr-skills.spec.md`).

## Every PR

- The spec workstream is named, and the spec's `Status` header says
  what this PR ships. `audit:specs --check` guards only the claim of
  no implementation (barwise-912). Authority: `spec-writer` skill.
- A tracking issue exists; the PR does not close it, and says the
  closure follows after merge. Authority: `steward` skill, section 5.
- Every number in the body has the command that produced it, and
  re-running the command gives that number. Authority:
  `pr-creation`, section 4.3.
- The reading guide accounts for every changed file, as spine or as a
  fallout pattern; a file it cannot place is a scope question.
  Authority: `pr-creation`, section 4.2.
- The Session review section is present; each entry names its
  landing or says it landed nowhere and why; a repeat names the ledger
  issue. Authority: `session-review` skill.
- No emoji in prose, and no model identifier in commit or PR prose.
  The harness-mandated footer and `Co-Authored-By` trailer are the
  exceptions: the repo tolerates the first, and the second is where a
  model name belongs. Authority: root `CLAUDE.md` conventions; the
  harness rule on model identity.
- The branch is on current `main` and carries no merge markers.

## When a surface changed (CLI, MCP, VS Code)

- The capability matrix in the root `CLAUDE.md` changed in the same
  commit; an unmarked gap is a bug. `docs/CLI.md` documents every
  command.
- `--artifacts` is not on a production command. Authority:
  `docs/specs/artifact-resolution-parity.spec.md`.
- Tests for the capability assert the capability, not a limitation.
  Authority: `assertion-audit` skill.

## When `@barwise/core` changed

- Nothing non-deterministic entered core: no I/O, clock, randomness,
  or network. `npm run purity` checks imports; `Date.now()` and
  `Math.random()` are judgment. Authority: root `CLAUDE.md`, design
  principles.
- A public-API change was followed by a full `npm run build` and the
  downstream packages compile against the new `dist`, not the old.
- A metamodel or serialization change bumps or handles
  `schemaVersion`.

## When a type was introduced, or a field's type chosen

The question this group asks is whether a type states what the code
already knows. Every item below is a defect that has actually occurred
here, and none of them fails a build today.

- **A closed set is a union, not `string`.** If any code compares the
  value against string literals, its type should be the union of those
  literals. `Diagnostic.ruleId` was `string` over 76 known values, and
  the breaking-level classifier string-matched prose the diff wrote
  until the two silently diverged. Authority:
  `docs/specs/closed-sets-as-unions.spec.md`; barwise-946.
- **A generic container names its domains, or says why it cannot.**
  `Record<string, string>` where both the keys and the values have
  knowable domains is the population-tuple defect: a fact instance
  accepts a key that is no role of its fact type and a value outside
  its player's declared type, and nothing reports either. Where the
  domain is runtime data a type genuinely cannot carry it, and the
  enforcement belongs in the constructor instead -- say which case this
  is. Authority: barwise-945.
- **An optional field the constructor guarantees is not optional, and a
  fallback for a state the constructor forbids is dead code.**
  `Constraint.id` is optional though `FactType` mints one for every
  constraint, so the serializer branches on a case that cannot occur;
  `RelationalMapper` computes a reference-mode fallback inside a branch
  where an entity always has one. Authority:
  `docs/specs/core-branching-load.spec.md`, Evidenced sites.
- **A consumer's parameter names what it consumes, not what its caller
  holds.** Widening a parameter to `Diagnostic<string>` to admit a
  caller is the wrong direction; a formatter that reads `severity` and
  `message` should ask for those two fields. Authority:
  `docs/specs/closed-sets-as-unions.spec.md`, WS2.
- **A surface extending a core set declares its own registry**, and
  core does not learn the surface's identifiers. Authority: same, WS2.

## When a copy was added or a copy was edited

- A must-agree pair carries a mechanical check in the same commit: a
  shared owner, a derivation, a `parity.manifest.json` entry, or a
  drift test. A "must match" comment is not a check. Authority:
  `duplication-audit` skill; `docs/specs/duplication-drift-guards.spec.md`.
- When one copy was edited, its siblings were grepped for and edited.
- A baseline row added to `audit-baseline.json`,
  `rubric-baseline.json`, or `spec-status-baseline.json` carries a
  note a later reader can act on, and no row was added to make a
  ratchet pass.

## When generated output changed

- The regenerator produced it (`regen:*` scripts, `UPDATE_GOLDEN=1`),
  not a hand edit, and a drift test exists for it. Authority:
  `steward` skill, section 2.

## When tests changed

- No `.skip`, no lowered coverage threshold, no assertion loosened to
  existence, no golden regenerated without a reason in the commit.
- A new test was seen failing on the defect it guards before it was
  seen passing. Authority: `session-review` skill.

## When a check, gate, hook, or script was added or changed

- It was watched going red on a planted defect placed where the gate
  looks (tracked or staged, not merely on disk), and
  `scripts/tests/*.test.mjs` pins that for a root gate. Authority:
  `session-review` skill; `npm run test:scripts`.
- It resolves paths from the repo root, not the cwd (barwise-918), and
  a new npm script has its root forwarder (`check:root-scripts`).

## When a spec was added or revised

- Requirements are in EARS form; open decisions are genuinely open
  with a recommended default; every mechanism a requirement names
  exists or is delivered by a named workstream; the header dates are
  current. Authority: `spec-writer` skill, the design gate.

## When Python was touched

- Every execution is `uv run --frozen [--only-group <g>]` from a cwd
  under `barwise/`; no bare `python3`, `pip`, `--with`, `--isolated`,
  or PEP 723 metadata. Authority: root `CLAUDE.md` conventions.

## When a skill, agent brief, CLAUDE.md, AGENTS.md, or prompt artifact changed

- Reviewed as logic, not documentation: each rule carries its reason;
  nothing restates what another file owns (point instead); it would
  have fired on the case that prompted it; a prompt artifact change
  went through `barwise prompt eval` rather than straight to
  production. Authority: `docs/specs/skills-restructure.spec.md`;
  root `CLAUDE.md` on `--artifacts`.

## When a dependency was added

- Node core or the language does not already provide it, and the
  lockfile was written by the package manager. Authority: root
  `CLAUDE.md` conventions.
