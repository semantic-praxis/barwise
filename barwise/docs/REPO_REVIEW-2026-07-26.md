# Repository review -- 2026-07-26 (v1.7.0 release)

Phase A architecture review at the v1.7.0 cadence point
(`docs/specs/architecture-analysis.spec.md`). Window: `v1.6.1..HEAD`,
82 non-merge commits across 14 merged PRs (#266-#278 plus the backlog),
ranked with `npm run arch:triage -- --base v1.6.1`.

## Release summary

The release closed the entire 2026-07-25 backlog: role-path/join
constraints with NORMA round-trip, UUIDv7 ids + `barwise history`,
annotation propagation, the modeling tutorial, the diagram track
(webview phases 2-4, renderer consolidation recorded, layout
aesthetics guard), the gym C6 loop with CLI/MCP surfaces, NORMA
diagram-geometry and construct round-trips, repo-analysis phase 3, the
sqlglot structural SQL tier, and the test/process net (release gate,
spawn smoke test, this review's `--base` flag).

## Reflexion (S-ORTH-1..3, S-DET-1..3)

Both gates are clean: every package imports only within its intended
set, and core carries no I/O, clock, randomness, or LLM SDK.

One finding surfaced by the run itself: the intended dependency graph
now lives in three places -- root `CLAUDE.md`, `.dependency-cruiser.cjs`
(the enforcing gate), and a private copy inside `scripts/arch-triage.mjs`
-- and the triage copy had not learned the `@barwise/learn` edge added
in #274, producing two false divergences. The copy is fixed in this
release. Judgment: acceptable duplication for now (the script is
deliberately dependency-free), but the sync duty is real; if it slips
again, make the script require the depcruise config's `INTENDED` map
instead of carrying its own.

Two triage-tool defects also fixed during this review, both of which
silently emptied the hotspot ranking: the git pathspec resolved only
when run from the git root (now pinned with `cwd`), and a shallow CI
clone cannot walk a release range at all (`git fetch --unshallow`
before a scoped run; the unknown-ref error now says so).

## Hotspots (change frequency x size)

Top of the ranking, with judgment:

1. `core/src/verbalization/constraints/phase2.ts` (8 commits, 562
   lines) -- accumulated join-constraint and modality verbalization.
   Cohesive but nearing the god-file threshold; candidate for the next
   decomposition pass if the Tier-3 constraint work continues.
2. `formats/src/norma/NormaXmlWriter.ts` (6, 731) and
   `NormaXmlSerializer.ts` (5, 657) -- grew with the join, construct,
   and geometry emission. Both remain single-concern (model->document,
   document->XML); size is feature surface, not mixed concerns. Watch,
   don't split yet.
3. `core/src/counterexample/CounterexampleGenerator.ts` (6, 580) --
   cross-fact-type work. Cohesive.
4. `core/src/serialization/OrmYamlSerializer.ts` (13 commits, 260
   lines) -- the highest churn count in core, but small and forced by
   metamodel additions (every new construct touches serialization by
   design). Expected coupling, not a smell.
5. `core/src/model/Constraint.ts` (7, 431) -- modality + cardinality +
   join operands. The metamodel's natural growth point.

No file in the ranking mixes concerns the way the pre-decomposition
`ElkLayoutEngine` did; the A1/A6 decompositions held through a heavy
feature cycle, which is the outcome those refactors were bought for.

## Temporal coupling

The cross-package co-change table is empty at the default threshold.
Caveat rather than celebration: this cycle's PRs were large
multi-package commits, and the triage caps coupling extraction at
25-file commits to keep sweeping changes from dominating, so much of
the window's signal was capped out. The per-file frequency data above
is unaffected. Re-read this axis next release, when commit sizes
normalize.

## Judgment calls the fitness functions cannot make

- **Three homes for the intended graph** (above): keep, with the sync
  duty noted; escalate to single-sourcing on the next slip.
- **`test-plan/` as release gate**: adopted this cycle. The harnesses
  run against built bundles in `release.yml`; the VS Code leg stays a
  manual checklist -- proportionate, revisit only if extension
  regressions start escaping.
- **sqlglot sidecar**: an optional Python subprocess in
  `@barwise/formats` is a new runtime seam. The degradation path (regex
  tier) is tested, and the purity gate keeps it out of core. Sound.
- **ELK test timeouts**: the 30s budgets added under #277 paper over
  real-ELK cost on loaded runners. Fine for correctness; if CI time
  becomes a concern, cache layouts per fixture instead.

## Standing follow-ups (unchanged priorities)

Aesthetics WS4 tuning (human golden-diff review); dbt SQL mining plus
dialect-targeted DDL export with capability profiles (ratified);
learning-content authoring (bias exercises, deck discrimination tier,
wider gym catalog); NORMA manual load check (in the test plan);
unary-role cardinality NORMA seat; `phase2.ts` decomposition if it
keeps growing.
