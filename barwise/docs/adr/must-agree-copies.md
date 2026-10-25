# Must-agree copies carry a check

Scope: process
Date: 2026-08-30
Tracking: barwise-ubc, barwise-868, barwise-871, barwise-872,
barwise-919, docs/specs/duplication-drift-guards.spec.md,
docs/specs/deterministic-guards.spec.md

## Context

DRY is secondary here: where sharing code would couple two packages,
the duplication stays. The 2026-08-26 audit
(`docs/logic-duplication-audit-2026-08-26.md`) found that the trade is
safe only when the copies are checked. Pairs with a shared owner, a
derivation or a drift test held. It found eight copies that had
already diverged, and roughly a dozen pairs that agreed only because
nobody had edited one copy yet. Two of those were guarded by nothing
more than a "Must match" comment. In every case, nothing told the
editor of one copy that the other existed. The reasoning, the order of
remedies and the rejected alternatives (extract every copy, clone
detection in CI, a lint rule that reads comments) are in the spec
above. `deterministic-guards.spec.md` added JSON field values as
members.

## Decision

1. **A copy that must agree with other code carries a mechanical check,
   in the commit that creates it.** The check is one of: a shared
   owner, a derivation from the authority, an entry in
   `barwise/parity.manifest.json`, or a drift test. A "must match"
   comment is not a check.
2. **Share or derive first; register or test when orthogonality rules
   those out.** Where sharing would couple packages, the copies stay
   parallel, and the check is what makes that safe.
3. **A registered set stays identical, and a member that does not
   resolve counts as drift.** A member is a whole file, a top-level
   function or variable declaration (compared without its leading
   comments), or a JSON field value. A set of whole files may opt out
   of one leading docblock, and nothing else may differ. A pair that
   needs more ignored is not a parity pair: give it a behavioural test
   or a shared owner. An entry is retired only in a commit that shares
   or derives the pair, or gives it a behavioural test.
4. **Every candidate the duplication detectors find carries a verdict.**
   `audit:duplication` finds candidates the same way every time, and a
   person classifies each one in `barwise/audit-baseline.json` as
   `accepted-benign` or `tracked:<issue>`. A new unclassified candidate
   fails the check, and so does a row that is no longer detected.

## Consequences

- `npm run check:parity` and `npm run audit:duplication -- --check` are
  CI steps with no `if:`, so they run on every push to main and every
  pull request to main. Both also run before each push through
  `ci:local`.
- `check:parity` gates decision 3's identity and resolution clauses.
  It compares raw text, where the spec designed a normalised
  comparison for whole files and a printed-AST comparison for symbols.
  It silently ignores an unknown `ignore` value instead of rejecting
  it (barwise-tdu). Decision 3's retirement clause has no gate:
  deleting a set makes the check pass, and only review catches it
  (`pr-review`, "Ratchets silenced").
- `audit:duplication --check` gates the both-ways half of decision 4.
  It checks only that a candidate's id is in the baseline, not what
  the verdict says or whether a `tracked:` issue exists (barwise-u5d).
- Decision 1 is gated only inside the detectors' scope, and only
  partly there. A new detectable copy fails `audit:duplication` until
  someone gives it a verdict, but `accepted-benign` passes as well as a
  check does. Outside that scope nothing gates it. Decision 2 has no
  gate. Both are held in review by the `spec-writer` parity check and
  the `pr-review` checklist group "When a copy was added or a copy was
  edited". The spec leaves pairs nobody registered to "the convention
  line and the periodic re-sweep".
- The detectors read only TypeScript under `packages/*/src` and
  instruction docs. They cannot see:
  - files at a package root (barwise-970);
  - one decision written two different ways (barwise-1072);
  - parity claims in source comments; anything in `scripts/`, `trial/`
    or `.mjs` files; and single-quoted, template or short literals
    (barwise-tml).
- Clone detection is advisory, by the spec's decision. It rejected
  jscpd as a CI gate because clone detectors report duplication the
  codebase allows, and they go quiet once a pair drifts. `npm run dup`
  runs with `continue-on-error`.
- The spec deferred comparing behaviour rather than bytes, and
  reconciling copies that had already diverged. The audit's diverged
  copies (barwise-863 to 867 and 873) are all closed.
- Until architecture-index WS5 replaces them with links, these places
  also state this rule (barwise-ubc, WS5):
  - the root `CLAUDE.md` conventions;
  - `duplication-drift-guards.spec.md` and
    `deterministic-guards.spec.md`;
  - the `duplication-audit`, `spec-writer`, `pr-review` and `steward`
    skills;
  - `REVIEW.md` "Do not report";
  - the headers of `check-parity.mjs` and `audit-duplication.mjs`.
