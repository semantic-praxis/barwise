---
name: duplication-audit
description: Use when writing code that restates a decision made elsewhere (a copied helper, a re-listed union, a table or prose restating code facts, a second surface wiring the same capability); when reviewing a diff that adds such a copy; or when auditing the codebase for must-agree copies that can drift silently. Carries the classification rubric, the five-pass sweep method, and the authoring rules that keep DRY-secondary duplication from becoming silent divergence.
---

# Duplication Audit: copies that must agree, and nothing checking

DRY is secondary in this codebase: parallel code in two packages is
preferred over an abstraction that couples them. That trade is safe
only under a stronger rule the repo honors inconsistently:

> A decision stated twice is owned once: every must-agree pair
> carries a mechanical check -- a shared owner, a derivation from one
> authority, or a drift test. A "must match" comment is not a check.

The precedents, for calibration:

- `docs/specs/artifact-resolution-parity.spec.md` (implemented,
  PR #347): "which prompt gets sent" answered independently in four
  places, agreeing by construction; the divergence was invisible
  because falling back to a default looks like choosing it. Remedy:
  one exported function (`selectArtifact`) owning the whole answer.
- `docs/logic-duplication-audit-2026-08-26.md`: the full sweep. Eight
  copies of single decisions had already diverged (the extraction
  default vs its variants; `TIMESTAMP` mapping to two conceptual
  types; the dbt walker mining `target/`), two "Must match" comments
  stood in for tests, and the artifact everyone cited as the
  drift-test precedent (`examples/output/`) had no drift test.
- The guarded pattern, where it was actually implemented, never
  failed: `builtins.generated.ts`'s drift test, the tutorial
  byte-compare, `regen-references.mjs` sharing its renderer with its
  guard.

The classification rubric -- apply it before calling anything a
defect:

| Verdict         | Meaning                                                          |
| --------------- | ---------------------------------------------------------------- |
| guarded         | A mechanical check fails when the copies disagree (verify the test exists; read it) |
| benign parallel | Copies serve genuinely different concerns; agreement not required |
| drift-prone     | Copies must agree; nothing checks; divergence would be silent    |
| diverged        | Drift-prone and the copies already disagree                      |

The discriminator is not "is this duplicated" but "**must these agree
for the system to be correct, and what notices when they stop?**"

## Authoring rules (the prevention)

**1. Before restating, look for the authority.** Most drifted copies
in the audit restated a fact something already owned: the format
registry (`listImporters()`), a core union type, a `Record<Union, T>`
table. If an authority exists, derive from it (a runtime array, a
generated enum) rather than re-listing. If none exists, the thing you
are about to write twice is the authority -- put it somewhere both
call sites can reach, unless that couples packages.

**2. When the copy must stay a copy, register it or test it in the
same commit.** Cross-package parallelism that orthogonality demands
(the `SqlglotBridge` pair, the surface `idGenerator`s) is legitimate
-- with an entry in `parity.manifest.json` (once
`docs/specs/duplication-drift-guards.spec.md` W2 lands) or a drift
test alongside. Never a comment: "Must match X" is the author knowing
the invariant and writing it where nothing can enforce it.

**3. A membership annotation is not a completeness check.**
`new Set<RingType>([...])` and `const ALL: readonly Union[]` prove
every listed entry is valid, not that every member is listed -- a new
union member silently stays absent. For completeness, derive from a
`Record<Union, true>` (`Object.keys` of it is checked both ways) or
make the switch exhaustive.

**4. A switch over a vocabulary union is exhaustive on purpose or
partial on purpose -- say which, mechanically.** Exhaustive: no
`default`, and in void contexts (where TS2366 cannot fire) an
`assertNever(x)` default. Partial: acceptable only for display-level
fallbacks; a `default` that silently degrades semantics
(`?? "irreflexive"`, `default: return "TEXT"`) converts vocabulary
growth into silent data corruption.

**5. Prose that restates code is a copy too.** A CLAUDE.md dependency
list, a doc's tool table, a "both surfaces do X the same way"
sentence -- each is a hand-maintained mirror. State facts the code can
outgrow only where a check exists (the capability matrix has its
audit convention) or where staleness is cheap; otherwise point at the
code instead of restating it. Counts weld prose to the current state
("both", "all three"): prefer wording that survives growth.

**6. When you fix one copy, grep for its siblings before you ship.**
Every diverged pair in the audit drifted because an edit landed on
one copy. Search for the duplicated string, the function name, and
the decision's distinctive literals; the audit doc's class C table is
the known-siblings index until the manifest exists.

## Audit method (finding the ones already in)

Run over a clean checkout of main. Deliverable is a dated findings
doc under `barwise/docs/` (`logic-duplication-audit-2026-08-26.md` is
the format): the rubric verdicts, findings with file:line evidence,
negative results (what was checked and cleared bounds the coverage),
and a follow-up index.

The sweep splits into deterministic **detection** (emitting
candidates) and human **classification** (assigning verdicts), and
only the second is this skill's job. Detection belongs to
`npm run audit:duplication`
(`docs/specs/duplication-drift-guards.spec.md`, workstream 5): run it
and classify its candidate report against the rubric. Until that
script lands, the five passes below are the manual detection
procedure -- and they remain the statement of what the script must
cover. Passes 1 and the shape-hunt half of 5 are inherently
judgment-loaded (comparing wirings, recognizing semantic clones);
even with the script, expect to read code there, seeded by its
candidates.

1. **Cross-surface wiring.** For each capability the CLAUDE.md matrix
   puts on 2+ surfaces, compare the CLI command, MCP tool, and VS
   Code wiring: are defaults, allowed-value lists, resolution rules,
   and output shapes obtained from a shared module or restated?
   Registries restated as prose/`z.enum` and policy functions copied
   between `cli/src/commands/` and `mcp/src/tools/` are the two
   recurring shapes.
2. **Literals, constants, unions.** Extract long string literals
   across `packages/*/src`, count cross-file duplicates, inspect.
   Trace each core union to its consumers; check every switch, `Set`,
   enum, and lookup table against rules 3-4. Regex literals too.
3. **Prose parity claims.** Grep docs, CLAUDE.md files, and skills
   for "same way", "in sync", "must match", "mirrors", "identical",
   "hand-maintained", counts, and tables restating code facts;
   spot-verify each against the code, and note whether anything
   checks it.
4. **Derived artifacts.** For every generated/committed-derived file:
   what regenerates it, and what fails when source and copy disagree?
   Read the drift test -- a citation of one is not one. Include
   version-sync literals and JSON schemas restating TS types.
5. **Structural clones.** `npx jscpd --min-tokens 60` over
   `packages/*/src` for the byte-level pairs, then shape hunts for
   semantic clones token tools miss (same decision, different
   literals): resolve-or-default shapes, same-named helpers across
   packages, skip/exclude lists, type-mapping tables.

Operational rules, learned in the first sweep:

- **Verify every finding against the current tree yourself** before
  it enters the doc -- sweeps run long, and a concurrent merge can
  fix (or move) a finding mid-pass.
- **Diverged beats identical in the ranking.** An already-diverged
  pair is both a live bug and proof the pair belongs to the class;
  lead with those.
- **Check the guard, not the claim of one.** Four sites cited a
  drift test for `examples/output/` that did not exist. "Guarded"
  requires reading the test and confirming it compares regeneration
  output against the committed copy.
- **Classify against the principles before filing.** Deliberate
  parallel copies that document themselves
  (`mcp/src/workspace/projectLoader.ts` header) are the codebase
  working as designed; the finding, if any, is only a missing check.
- Fix only what is small and unambiguous in the sweep itself; file
  the rest (beads, `bd`) with evidence. Reconciling a diverged pair
  is a behavioral change -- it needs its own change, with a decision
  about which copy is right.
