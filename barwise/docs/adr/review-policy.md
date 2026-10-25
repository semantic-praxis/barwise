# Review policy

Scope: process
Date: 2026-10-24
Tracking: barwise-ilb, barwise-1040, barwise-1050, barwise-953,
barwise-nm8, barwise-16u, barwise-j9d, docs/specs/tiered-pr-review.spec.md,
docs/specs/review-md.spec.md, docs/specs/review-routing.spec.md

## Context

Review here was a caller's responsibility, and callers did not ask: of
eight merged pull requests sampled on 2026-09-17, seven carried no
recorded review (`tiered-pr-review.spec.md`, Principle; barwise-953). A
workflow-requested Copilot review was built so that review happens to a
pull request rather than being started by someone, and a path-derived
tier was to decide whether it blocked the merge. On 2026-09-23 the owner
chose to review every non-trivial change and block nothing ("The
decision of 2026-09-23", amended 2026-10-01 for Dependabot). The root
`REVIEW.md` then mapped the review lanes and the failure modes reviews
keep finding (`review-md.spec.md`), and on 2026-10-24
`review-routing.spec.md` put the tier classifier's routing in front of
every reviewer. Who may merge, and on what condition, is a separate
decision (`steward` section 4b).

## Decision

1. **Every non-trivial pull request not opened by Dependabot has one
   Copilot review requested.** A pull request is trivial only when every
   change is an edit to a path on the `trivial` allow-list in
   `barwise/review-tiers.json`, read from `main`'s copy. Every
   uncertainty -- an unreadable file list, a classifier refusal --
   resolves toward requesting.
2. **Nothing blocks a merge on Copilot.** A refusal from an exhausted
   quota is not a review and not a blocker: work carries on without it,
   the workflow asks again on the next push, and nobody re-requests by
   hand or pushes an empty commit to force a run.
3. **`REVIEW.md` owns which review lane runs when.** CI on every push;
   `/code-review` by the author before opening; `/security-review`
   before opening when the diff meets a trigger REVIEW.md lists;
   `/pr-review`, which runs `/code-review` itself, on the head being
   merged; the Claude Code Review service on every pull request once an
   Owner enables it. A review does not report what CI enforces.
4. **The tier is information, and routing orders rather than filters.**
   `npm run pr:risk` prints the tier, the checklist groups and the
   REVIEW.md failure modes a diff triggers, with the files. Author and
   reviewer run every group it lists, every group no path can detect,
   and every failure mode, and the reviewer says which ran. Nothing
   fails on the tier or the routing.
5. **What reviews keep finding is prevented upstream.** Findings are
   classified by failure mode, the most common one gets a mechanism in
   front of review, and REVIEW.md's "Always check" list ranks the modes
   every review runs.

## Consequences

- `npm run check:review-tiers` (a `ci.yml` step with no `if:` guard, so
  on every push to and pull request against `main`) keeps the routing
  table in step: it fails when a `checklist.md` heading or a REVIEW.md
  "Always check" title has no row, when a row names one that no longer
  exists, and when a file-shaped pattern leaves same-named files
  unreached, and exits 2 when an input is unreadable. It does not check
  that anyone reads the routing.
- Decision 1's mechanism is `.github/workflows/copilot-review.yml`:
  `main`'s allow-list, the Dependabot skip, and a refusal not counted as
  a review. Its shell runs against a stubbed `gh` in `gates.test.mjs`,
  under the `test:scripts` step (`if: docs_only != 'true'`). The request
  job has been paused since 2026-10-19 and runs only on a manual
  dispatch, so decision 1 is not carried out until the quota resets
  (barwise-ilb). Copilot also reads hand-written modelling guidance, not
  the checklist: the generated instructions and their drift gate are
  unbuilt (barwise-1040).
- Decision 2 has no gate, by design: nothing reads a Copilot verdict.
- Decision 3 has no gate. `pr-creation` and `pr-review` hold it, and
  nothing records that `/code-review` or `/security-review` ran
  (barwise-953). The `/security-review` triggers live only in REVIEW.md's
  prose, and `pr-risk` does not route them (barwise-16u). REVIEW.md's lane table omits the Copilot
  lane, which only `tiered-pr-review.spec.md` and `steward` section 7
  describe (barwise-j9d).
- Decision 4: nothing records that `pr-risk` ran on the reviewed head or
  that its groups were run (barwise-953). Printing the routing in CI was
  deferred by the owner on 2026-10-24 until reviewers are shown to use
  it (`review-routing.spec.md`, WS3; barwise-6mf).
- Decision 5 has no gate. The classification has had its seed pass and
  first mechanism, and the pass that measures that mechanism is open
  (barwise-1050); no reviewer is scored against real defects (barwise-nm8).
- Decided, with the cost stated:
  - no gate blocks a merge on review, giving up a guarantee that a
    finding is addressed before merge (the decision of 2026-09-23);
  - Dependabot pull requests are not requested, because Copilot drops
    the request for that author (amendment of 2026-10-01);
  - a quota reset triggers nothing, so a pull request with no later push
    goes without a Copilot review ("the accepted cost", `steward` 7).
- Left to an Owner, not decided here: enabling the Claude Code Review
  service and protecting `main` are repository settings outside the
  tree (`review-md.spec.md`, Scope); the service is not enabled.
- The trivial exemption is Copilot's alone: the review before a merge
  has no exemption by size (`steward` section 4b).
- Until architecture-index WS5 replaces them with links, the root
  `CLAUDE.md` conventions, `REVIEW.md`, the `copilot-review.yml` header,
  `review-tiers.json`, the `steward`, `pr-review` and `pr-creation`
  skills, and `review-md.spec.md` and `review-routing.spec.md` also state
  this rule (barwise-ubc, WS5).
