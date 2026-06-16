# Architecture analysis program: from one-off review to encoded discipline

Status: Draft for review (design only -- no implementation in this PR)
Tracking: addresses the standing concern that rapid change is eroding
architectural discipline. Operationalizes the manual audit captured in
`REPO_REVIEW-2026-06.md` and the principles in the root `CLAUDE.md`.
Related findings: #2 (connector/core purity), #4 (CLAUDE.md drift),
A1 (god files), A3 (barrel export).

## Principle

All five design pillars are stated in prose and audited _manually and
occasionally_. The June 2026 REPO_REVIEW was a one-off human reflexion
of the architecture against those pillars; it found real drift (a dead
CI workflow, I/O leaking into core, a stale dependency graph in
CLAUDE.md). The review was good work, but it is not repeatable, and
between reviews only two architectural properties are guarded
continuously: _no import cycles_ (`madge --circular`) and _no dead
exports_ (`knip`).

That leaves the two pillars most exposed to incremental drift with no
automated guard at all:

- **Orthogonality.** The one-way dependency graph (core depends on
  nothing internal; connectors depend only on core; cli/mcp/vscode sit
  at the top) is enforced for _cycles_ but not for _direction_. The
  `circular` script passes only `--circular`, so nothing fails CI if
  core grows an import from `@barwise/diagram`, as long as no cycle
  closes. The graph lives in CLAUDE.md prose, which has already drifted
  once (finding #4).
- **Determinism in core.** "No I/O, no clocks, no LLM in core" was
  violated by pre-connector leftovers (finding #2: `readFileSync` in
  lineage, `process.env` in `DbtDialectDetector`). Those were migrated
  out by hand, but nothing stops the next one. There is no check that
  `core/src` is free of `node:fs`, `node:child_process`, `process.env`,
  wall-clock, or non-seeded randomness.

The prior art on architecture analysis splits cleanly along this seam,
and the resolution follows from it directly.

## What the prior art says (and what we take from it)

Four established families of architecture analysis apply here. Each
maps onto a pillar and a phase of this program.

| Method family                                | Core idea                                                                                   | What we take                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Scenario-based evaluation (SAAM, ATAM)       | Enumerate quality-attribute scenarios, map each to the architecture, surface risks          | A principle-to-scenario catalog driving the one-time deep review (Phase A)         |
| Architecture fitness functions (Ford et al.) | An executable rule that measures whether a property survives as the code changes            | Encode orthogonality and determinism as CI gates (Phase B); `madge`/`knip` already |
| Reflexion models / DSM (Murphy & Notkin)     | Diff the _intended_ structure against the _actual_ one extracted from code; flag divergence | The dependency-direction gate; make the CLAUDE.md graph a checked artifact         |
| Behavioral code analysis (CodeScene)         | Use VCS history -- change frequency, change coupling, hotspots -- to prioritize debt        | A git-history triage that ranks where review effort pays off                       |

The throughline: reserve _scenario-based human judgment_ for what
cannot be automated (composability trade-offs, DRY-vs-coupling calls),
and convert the _structural_ pillars (orthogonality, determinism) into
fitness functions so drift is caught on the PR that introduces it, not
at the next audit.

## Scope

In scope:

- A repeatable architectural evaluation _method_ for barwise: a
  principle-to-scenario catalog and the procedure for applying it.
- A one-time deep assessment (Phase A) that refreshes the REPO_REVIEW
  using that method, informed by a reflexion snapshot and a
  git-history hotspot triage.
- Encoding the structural pillars as CI fitness functions (Phase B): a
  dependency-direction conformance gate and a core-determinism gate.
- Making the CLAUDE.md dependency graph a machine-checked artifact so
  it cannot silently drift from the code again.
- A lightweight recurring-review cadence so Phase A becomes routine,
  not heroic.

Out of scope:

- Changing the architecture itself. This program _measures and guards_;
  any refactor it surfaces (e.g. the A1 god files) is its own spec.
- A commercial behavioral-analysis platform (CodeScene). We script the
  subset we need (change coupling, hotspots) from `git log`.
- Runtime quality attributes (latency, availability). Barwise is a
  deterministic toolkit, not a service; the ATAM-style scenarios here
  are modifiability/orthogonality scenarios, not performance ones.

## Inventory

What this program adds or touches. No production source changes in
Phase A; Phase B adds tooling and CI steps only.

| Area                                 | Current state                                              | Verdict                                            |
| ------------------------------------ | ---------------------------------------------------------- | -------------------------------------------------- |
| `docs/specs/architecture-analysis.*` | absent                                                     | new: this spec, the method, the scenario catalog   |
| `docs/REPO_REVIEW-<date>.md`         | one report (2026-06), manual                               | new dated report each assessment cycle (Phase A)   |
| `package.json` `circular` script     | `madge --circular` over each package src, cycles only      | superseded by / complemented with a direction gate |
| dependency-direction rule            | none (prose graph in CLAUDE.md only)                       | new: encoded, checked artifact (Phase B)           |
| core-determinism rule                | none (manual review only; finding #2 fixed by hand)        | new: forbidden-import gate on `core/src` (Phase B) |
| `.github/workflows/ci.yml`           | gates fmt, build, test:coverage, lint, knip, oxlint, madge | gains the two conformance steps (Phase B)          |
| `scripts/`                           | `validate-examples.sh`                                     | gains a read-only hotspot/coupling triage script   |
| root + package `CLAUDE.md` graphs    | hand-maintained prose, drifted once (finding #4)           | becomes generated-or-checked against the rule set  |

Knip and madge are _not_ removed without replacement: the direction
gate (dependency-cruiser) can subsume the `--circular` check, so madge
may retire once the new gate covers cycles too (a DRY consolidation,
noted as an open decision rather than assumed).

## Target architecture

The end state is a two-layer discipline -- continuous gates for the
structural pillars, a periodic human review for the judgment pillars --
both driven from one documented method.

```
docs/
  specs/architecture-analysis.spec.md   # this: the method + the plan
  architecture-scenarios.md             # principle -> testable scenarios (Phase A WS1)
  REPO_REVIEW-<date>.md                 # periodic deep assessment (Phase A output)

scripts/
  arch-triage.mjs                       # git-history hotspots + change coupling (read-only)

.dependency-cruiser.cjs                 # the intended graph, encoded (reflexion model)
  rules:
    - core depends on no internal @barwise/* package
    - connectors (diagram, diagram-ui, llm, code-analysis, dbt, formats)
      depend only on @barwise/core (+ diagram-ui on diagram)
    - cli/mcp/vscode are the only top-of-stack consumers
    - no cycles (subsumes the madge --circular check)
    - core/src imports none of: node:fs, node:child_process,
      node:os, process.env, Date.now/new Date, Math.random,
      global crypto.*, @anthropic-ai/sdk, openai

.github/workflows/ci.yml
  + depcruise (direction + cycles + core purity)   # gating once green

CLAUDE.md dependency graph  <--- checked against .dependency-cruiser.cjs
```

The dependency-cruiser config _is_ the reflexion model: the intended
graph expressed as machine-checkable rules, diffed against the actual
import graph on every PR. The CLAUDE.md prose graph becomes a rendering
of that single source of truth, not a parallel hand-maintained copy.

## Alternatives considered

- **Extend the existing `madge` invocation.** madge does cycles well
  but has no rule language for "core may not import diagram" or
  forbidden built-in modules. It would stay a cycle checker beside a
  second tool. Rejected: dependency-cruiser does cycles _and_ rule
  conformance _and_ forbidden-dependency checks in one config, so it
  consolidates rather than adds (DRY, composability). madge can retire.
- **ESLint `no-restricted-imports` + import boundaries plugin.** Works
  for the forbidden-import half (core purity), and we already run
  ESLint. But cross-package _direction_ rules are awkward to express
  per-package in ESLint config, and ESLint sees one file at a time --
  it cannot assert graph-level properties (acyclicity, reachability).
  Rejected as the primary tool; may still carry the in-file purity
  rules if depcruise proves heavy. Surfaced as an open decision.
- **ArchUnitTS / ts-arch (fluent in-test assertions).** Idiomatic
  (ArchUnit-style) and runs in Vitest. Rejected for the _gate_ because
  it scatters architectural truth across test files instead of one
  declarative artifact that doubles as the documented graph; the
  reflexion model wants a single readable source. Reconsider if a
  future rule is easier to express as a test than as config.
- **Adopt CodeScene (commercial).** Best-in-class behavioral analysis,
  but a paid platform for a signal we need only periodically. Rejected:
  script the change-coupling/hotspot subset from `git log` for the
  Phase A triage; revisit only if the periodic review outgrows it.
- **One-time review only (no fitness functions).** Repeats the 2026-06
  audit on a cadence. Rejected: it leaves orthogonality and determinism
  guarded only by human attention between reviews -- exactly the drift
  the standing concern is about. The structural pillars are mechanically
  checkable; not checking them is the gap.

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. Phase A (WS1-WS3) is docs and
read-only scripts: zero production-code risk, lands immediately. Phase B
(WS4-WS6) adds CI machinery, each step report-only before it gates.

### 1. Evaluation method and scenario catalog (Phase A)

`docs/architecture-scenarios.md`: translate each pillar into testable
modifiability scenarios in EARS phrasing -- "When a new interop format
is added, the system shall require zero changes to `@barwise/core`."
Each scenario names the pillar it defends, whether it is _automatable_
(becomes a Phase B fitness function) or _judgment_ (stays in the human
review), and how to evaluate it. This is the SAAM/ATAM contribution:
the catalog is the input to every future assessment. Pure addition; no
code touched.

### 2. Reflexion snapshot and hotspot triage (Phase A)

`scripts/arch-triage.mjs` (read-only): from `git log --numstat`,
compute per-file change frequency and pairwise change coupling (files
that change together across commits), and cross with file size to rank
hotspots. Separately, run a throwaway dependency-cruiser pass to record
the _current_ divergences from the intended graph (the reflexion diff)
without gating anything yet. Output feeds WS3. The script reads history
only; it changes nothing and need not run in CI.

### 3. Refreshed deep assessment (Phase A)

`docs/REPO_REVIEW-<date>.md`: apply the WS1 catalog, using the WS2
reflexion diff and hotspot ranking to prioritize. Same report shape as
2026-06 (checkboxes, priorities, file paths so findings convert to bd
issues), but now method-driven rather than ad hoc. This is the
deliverable that directly answers the standing concern: a current,
rigorous read on whether discipline is holding.

### 4. Dependency-direction conformance gate (Phase B)

`.dependency-cruiser.cjs` encoding the one-way graph as forbidden-rule
sets, plus the cycle check (subsuming `madge --circular`). Added to CI
as a _report-only_ step first (`continue-on-error`) so any existing
divergence surfaces without blocking, then flipped to gating once green.
This is the reflexion model made continuous: the single highest-value
fitness function, defending orthogonality. Couples to WS6 (the CLAUDE.md
graph should cite this config once it exists).

### 5. Core-determinism gate (Phase B)

Forbidden-import rules over `core/src`: no `node:fs`,
`node:child_process`, `node:os`, `process.env` reads, wall-clock
(`Date.now`, `new Date()`), `Math.random`, global `crypto.*` (the
`node:crypto` `randomUUID` import stays -- it is the deterministic,
declared convention), and neither LLM SDK. Report-only, then gating.
Defends "determinism in core" and makes finding #2 non-regressable.
Expressed in the same `.dependency-cruiser.cjs` if WS4 lands first;
otherwise the ESLint fallback (open decision).

### 6. Make the graph a checked artifact + review cadence (Phase B)

Point the root and package `CLAUDE.md` dependency graphs at
`.dependency-cruiser.cjs` as the source of truth (a short note: "the
authoritative graph is the depcruise config; this is its rendering"),
closing finding #4's drift class structurally. Add a short cadence note
to `CLAUDE.md` (or `AGENTS.md`): run the Phase A assessment on a
defined trigger -- e.g. each minor release, or every N merged PRs --
using this spec's method. A file-size budget (soft warning over a
threshold, informed by the WS2 hotspot ranking and finding A1) is an
optional add here; recommend warn-only, never gating, since size is a
smell not a rule.

## API and migration impact

- No public API changes. No `@barwise/*` package source moves. The
  build surface is untouched; this program adds docs, one script, one
  config file, and CI steps.
- Phase B CI steps are additive and start non-blocking, so no PR is
  retroactively broken; each flips to gating only after the tree is
  green against it.
- If WS4 subsumes the cycle check, the `circular` npm script and the
  `madge` dev dependency are removed in that same PR (the only deletion
  in the program).

## Open decisions (for review)

- **Conformance tool: dependency-cruiser vs ESLint-only vs ArchUnitTS.**
  Recommend dependency-cruiser as the single declarative artifact -- it
  does direction rules, forbidden built-ins, and cycles in one config
  that doubles as the documented reflexion model, and it lets `madge`
  retire. ESLint `no-restricted-imports` is the fallback for the
  core-purity half if depcruise proves heavy for the in-file checks.
- **Retire `madge` or keep both.** Recommend retiring once the
  depcruise cycle rule is proven equivalent on this repo (DRY). Keep
  both for one release if reviewers want a belt-and-suspenders overlap.
- **Cadence trigger for Phase A.** Recommend "every minor release"
  (the project already treats releases as intentional acts), over a
  per-PR or per-N-commits trigger. The reviewer owns this.
- **File-size budget (WS6).** Recommend warn-only or omit entirely;
  A1's god files are a known, separately-specced concern and a hard
  size gate would fight legitimate large generated/cohesive files.

## Risks and testing

- The fitness functions must not produce false positives that erode
  trust in the gate. Mitigation: every Phase B check lands report-only
  first; it gates only after a clean run on `main`, and the allowed
  exceptions (e.g. `node:crypto` randomUUID in core) are written into
  the config with a comment, not discovered in CI.
- The reflexion config can itself drift from CLAUDE.md. Mitigation: WS6
  makes the config the single source and the prose a rendering of it,
  so there is one place to change.
- The hotspot triage is advisory, not a gate: a noisy ranking costs
  nothing but a re-run. It reads git history only and is excluded from
  CI.
- Land as separate PRs per workstream, smallest first. After each Phase
  B PR, the existing suite plus the new step must be green on `main`
  before the step flips to gating.

## Non-goals

- No refactoring of production code. Findings that call for refactors
  (god files, barrel slimming) are filed as their own specs, not done
  here.
- No new runtime/performance quality attributes; barwise's relevant
  attributes are modifiability and the structural pillars.
- No replacement of the existing knip/oxlint/dprint gates; this program
  adds two architectural checks beside them, it does not reorganize the
  toolchain.
