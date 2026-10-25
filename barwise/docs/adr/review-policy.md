# Review policy

Scope: process
Date: 2026-10-24
Tracking: barwise-ilb, barwise-1040, barwise-1050, barwise-953,
barwise-nm8, barwise-16u, barwise-j9d, barwise-m9q, barwise-gin,
docs/specs/tiered-pr-review.spec.md, docs/specs/review-md.spec.md,
docs/specs/review-routing.spec.md

## Context

Review here was a caller's responsibility, and callers did not ask: of
eight merged pull requests sampled on 2026-09-17, seven carried no
recorded review (`tiered-pr-review.spec.md`, Principle; barwise-953). A
workflow-requested Copilot review was built so that review happens to a
pull request rather than being started by someone, and a path-derived
tier was to decide whether it blocked the merge. On 2026-09-23 the owner
chose to review every non-trivial change and block nothing on Copilot
("The decision of 2026-09-23", amended 2026-10-01 for Dependabot). The
root `REVIEW.md` then mapped the review lanes and the failure modes
reviews keep finding (`review-md.spec.md`), and on 2026-10-24
`review-routing.spec.md` made the `pr-review` and `pr-creation` skills
start from the tier classifier's routing. Who may merge, and on what
condition, is a separate decision (`steward` section 4b).

## Decision

1. **Every non-trivial pull request not opened by Dependabot has one
   Copilot review requested.** A pull request is trivial only when every
   change is an edit to a path on the `trivial` allow-list in
   `barwise/review-tiers.json`, read from `main`'s copy. Every
   uncertainty -- an unreadable file list, a classifier refusal --
   resolves toward requesting.
2. **Nothing blocks a merge on Copilot.** A refusal from an exhausted
   quota is not a review and not a blocker: work carries on without it,
   and the workflow asks again on the next push.
3. **`REVIEW.md` owns which review lane runs when.** CI on every push
   to `main` and every pull request into it;
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
5. **What reviews keep finding is prevented upstream.** Copilot's
   findings are classified by failure mode and the most common one gets
   a mechanism in front of review; REVIEW.md's "Always check" list,
   drawn from a month of all reviews' findings, ranks the modes every
   review runs.

## Consequences

- `npm run check:review-tiers` (a `ci.yml` step with no `if:` guard)
  keeps the routing table in step. It fails on a checklist heading or
  REVIEW.md title with no row, a row naming one that no longer exists, a
  heading or title declared twice, a glob matching no tracked file, a
  file-shaped glob leaving same-named files unreached, and a stale
  `reachAcknowledged` entry; it exits 2 when an input cannot be read or
  is malformed. It does not check that anyone reads the
  routing.
- Decision 1's mechanism is `.github/workflows/copilot-review.yml`,
  whose shell runs against a stubbed `gh` in `gates.test.mjs` (the
  `test:scripts` step, `if: docs_only != 'true'`). Since 2026-10-19 the
  request job runs only on a manual dispatch, so neither decision 1 nor
  decision 2's re-ask on the next push is carried out until someone
  restores its `if:` (barwise-ilb). Two exceptions to decision 1 have no
  deciding source: drafts are skipped until marked ready, and a failed
  read of the reviews or the request events stops the job red without
  requesting (barwise-m9q). Copilot reads hand-written modelling guidance, not the
  checklist (barwise-1040).
- Decision 2 has no gate, by design: nothing reads a Copilot verdict.
- Decision 3 has no gate. `pr-creation` and `pr-review` hold it, and
  nothing records that `/code-review` or `/security-review` ran
  (barwise-953). A stacked pull request gets no CI until `main` is
  merged into it after its parent merges (`steward` section 4a). `pr-risk` does not
  route the `/security-review` triggers (barwise-16u), and REVIEW.md's
  lane table omits the Copilot lane (barwise-j9d).
- Decision 4: nothing records that `pr-risk` ran on the reviewed head or
  that its groups were run (barwise-953). Printing the routing in CI was
  deferred by the owner on 2026-10-24 until reviewers are shown to use
  it (`review-routing.spec.md`, WS3; barwise-6mf).
- Decision 5 has no gate. The classification has had its seed pass and
  first mechanism; the pass that measures that mechanism is open
  (barwise-1050) and has no new Copilot findings to read while the
  request is paused (barwise-ilb). No reviewer is scored against real
  defects (barwise-nm8).
- Decided, with the cost stated: no merge waits on a Copilot review,
  giving up a guarantee that its findings are addressed before merge
  (the decision of 2026-09-23); Dependabot pull requests are not
  requested, because Copilot drops the request for that author
  (amendment of 2026-10-01). An agent's merge carries its own review
  condition (`steward` section 4b), which no check enforces (barwise-zdd).
- Open, left to the owner: a quota reset re-requests nothing, so a pull
  request with no later push is never reviewed by Copilot. The spec
  names this as a risk, not a decision, and `steward` section 7's ban
  on re-requesting by hand or by an empty commit was written by an agent
  (barwise-gin). Enabling the
  Claude Code Review service and protecting `main` are an Owner's
  settings (`review-md.spec.md`, Scope); the service was not enabled as
  of 2026-10-23.
- Until architecture-index WS5 replaces them with links,
  `tiered-pr-review.spec.md`, `REVIEW.md`, the root `CLAUDE.md`
  conventions, the `copilot-review.yml` header, `review-tiers.json`, the
  `steward` (section 7), `pr-review` (section 3 and `checklist.md`) and
  `pr-creation` skills, `review-md.spec.md` and
  `review-routing.spec.md` also state this rule (barwise-ubc, WS5).
