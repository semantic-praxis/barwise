# Must-agree copies carry a check

Scope: process
Date: 2026-08-30
Tracking: barwise-ubc, barwise-868, barwise-871, barwise-872, barwise-tdu,
barwise-u5d, barwise-tml, barwise-iil,
barwise-919, docs/specs/duplication-drift-guards.spec.md,
docs/specs/deterministic-guards.spec.md
Enforced-by: npm run audit:duplication -- --check (every-candidate-verdict),
npm run check:parity (registered-sets-identical),
none (barwise-ym8.edf: check-on-copy), none (barwise-ym8.3tg: check-first),
none (barwise-ym8.8nq: registered-sets-identical),
none (barwise-ym8.onf: every-candidate-verdict)

## Context

DRY is secondary here: where sharing code would couple two packages,
the duplication stays. The 2026-08-26 audit
(`docs/logic-duplication-audit-2026-08-26.md`) found that this trade
is safe only when the copies are checked. Pairs with a shared owner, a
derivation or a drift test held. Where agreement was left to prose,
the audit found eight copies that had already diverged, and roughly a
dozen pairs that were still identical but that nothing checked. Two
of those pairs carried a comment naming the other copy. A comment
tells a careful editor where the other copy is, but nothing fails when
the two drift apart. The reasoning and the rejected alternatives
(clone detection in CI, a lint rule that reads comments) are in the
spec above. `deterministic-guards.spec.md` added JSON field values as
members.

## Decision

1. **A copy that must agree with other code carries a mechanical check,
   in the commit that creates it.** {#check-on-copy} The check is one of four: a shared
   owner, a derivation from the authority, an entry in
   `barwise/parity.manifest.json`, or a drift test. A comment asking
   the editor to update the other copy is not a check.
2. **Check first; share case by case.** {#check-first} The spec settled this ("the
   check is the cheap, universal move and the share is a case-by-case
   optimization"). A check costs a manifest line and forbids nothing
   about the design. An extraction is a design change, decided each
   time, and the check is what proves that the extraction preserved
   behaviour. Where sharing would couple packages, the copies stay
   parallel.
3. **A registered set stays identical, and a member that does not
   resolve counts as drift.** {#registered-sets-identical} A member is a whole file, a named
   symbol or a JSON field value. Per the spec, a whole file is
   compared by normalised text and a symbol by its printed syntax
   tree, so a difference in formatting alone is not drift. The one
   allowed difference is a leading docblock. A pair that needs more
   ignored is not a parity pair: give it a behavioural test or a shared
   owner. An entry is retired only in a commit that shares or derives
   the pair, or gives it a behavioural test.
4. **Every candidate the duplication detectors find carries a verdict.** {#every-candidate-verdict}
   `audit:duplication` finds candidates the same way every time, and a
   person classifies each one in `barwise/audit-baseline.json` as
   `accepted-benign` or `tracked:<issue>`. A new unclassified candidate
   fails the check, and so does a row that is no longer detected.

## Consequences

- `npm run check:parity` and `npm run audit:duplication -- --check` are
  CI steps with no `if:` guard. CI runs on pushes to main and pull
  requests into main, and these steps run in every such run that
  reaches them; a step with no guard is skipped once an earlier step
  fails. `ci:local` runs both before each push, and it keeps going
  after a failure.
- `check:parity` fails when members differ, or when a member does not
  resolve. Several parts of decision 3 escape it (barwise-tdu):
  - it compares raw text, not normalised text or printed syntax trees;
  - it resolves only top-level function and variable declarations;
  - it ignores an unknown `ignore` value, and any `ignore` on a symbol
    or field set, without saying so;
  - a set with one member, or with none, passes trivially, so dropping
    members is an unchecked partial retirement.
- Nothing gates decision 3's retirement clause, or decision 4's verdict
  content (barwise-ym8.8nq, barwise-ym8.onf; related barwise-u5d). `pr-review` lists both under "Ratchets
  silenced". `REVIEW.md`'s "Do not report" tells reviewers to skip
  registered copies and the duplication ratchet because CI enforces
  them, so the review instructions contradict each other (barwise-iil).
- Decision 1 is gated only partly, and only inside the detectors'
  scope. A new detectable copy fails `audit:duplication` until it has a
  verdict, but `accepted-benign` passes as well as a check does.
  Outside that scope nothing gates it, and nothing gates decision 2.
  Both are held in review, by the `spec-writer` parity check and the
  `pr-review` checklist group "When a copy was added or a copy was
  edited". The spec leaves pairs nobody registered to "the convention
  line and the periodic re-sweep".
- The detectors read TypeScript under `packages/*/src`, plus Markdown:
  the root instruction files, each package's `CLAUDE.md`, and every
  doc under `docs/` that is not a spec, an archive or an audit. They
  cannot see:
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
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule:
  - `duplication-drift-guards.spec.md` and
    `deterministic-guards.spec.md`;
  - the `duplication-audit`, `spec-writer`, `pr-review` and `steward`
    skills;
  - `REVIEW.md` "Do not report";
  - the headers of `check-parity.mjs` and `audit-duplication.mjs`.
