# Review policy

Scope: process
Date: 2026-11-24
Tracking: barwise-ilb, barwise-1040, barwise-1050, barwise-953,
barwise-nm8, barwise-16u, barwise-m9q, barwise-gin, barwise-slv,
docs/specs/tiered-pr-review.spec.md, docs/specs/review-md.spec.md,
docs/specs/review-routing.spec.md, docs/specs/review-before-open.spec.md
Enforced-by: tests (copilot-requested, tier-informs, review-md-owns-lanes, review-before-open),
npm run check:review-workflows (review-md-owns-lanes, copilot-requested, copilot-never-blocks, tier-informs),
none (barwise-ym8.8ya: copilot-never-blocks)

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
start from the tier classifier's routing. The author's own review before
opening stayed a practice, and was skipped on four recorded pull
requests (barwise-953), so on 2026-11-20 the owner chose to refuse the
opening call instead (`review-before-open.spec.md`). Who may merge, and
on what condition, is a separate decision (`steward` section 4b).

## Decision

1. **Every non-trivial pull request not opened by Dependabot has one
   Copilot review requested.**{#copilot-requested} A pull request is trivial only when every
   change is an edit to a path on the `trivial` allow-list in
   `barwise/review-tiers.json`, read from `main`'s copy. Every
   uncertainty -- an unreadable file list, a classifier refusal --
   resolves toward requesting.
2. **Nothing blocks a merge on Copilot.**{#copilot-never-blocks} A refusal from an exhausted
   quota is not a review and not a blocker: work carries on without it,
   and the workflow asks again on the next push.
3. **`REVIEW.md`'s lane table names every review lane and its trigger,
   and the CI lane's triggers match `ci.yml`.**{#review-md-owns-lanes}
   The merge lane's timing is
   `merge-delegation.md#review-before-merge`.
4. **The tier is information, and routing orders rather than filters.**{#tier-informs}
   `npm run pr:risk` prints the tier, the checklist groups and the
   REVIEW.md failure modes a diff triggers, with the files. Author and
   reviewer run every group it lists, every group no path can detect,
   and every failure mode, and the reviewer says which ran. Nothing
   fails on the tier or the routing.
5. **A session opens a pull request only after `/code-review` returned
   and the `pr-review` checklist was read whole, in that session, on the
   commit the pull request proposes.**{#review-before-open} The owner's
   instruction to open without that is quoted in the body on a line
   starting `Opened-without-review:`.

## Consequences

- Decision 3 was restated on 2026-11-06 (`adr-refactor.spec.md`, row
  16) to what a check can read. What it listed stays true as practice:
  CI runs on every push to `main` and every pull request into it;
  `/code-review` by the author before opening; `/security-review`
  before opening when the diff meets a trigger REVIEW.md lists;
  `/pr-review`, which runs `/code-review` itself, on the head being
  merged; the Claude Code Review service on every pull request once an
  Owner enables it. A review does not report what CI enforces, which is
  judgment and audit material, not a gate. `REVIEW.md`'s CI row said
  "Every push" and its table had no Copilot row (barwise-j9d); the pull
  request that landed `check:review-workflows` corrected both, after the
  gate's first run found them.

- `npm run check:review-workflows` (a `ci.yml` step with no `if:` guard,
  `scripts/check-review-workflows.mjs`, rules named for the decisions
  they hold) reads `.github/workflows/*.yml`, `REVIEW.md`,
  `barwise/review-lanes.json`, the scripts and the tracker, and exits 2
  when an input cannot be read. `review-md-owns-lanes`: the table and
  `review-lanes.json` name the same lanes, every lane's source exists,
  every workflow file is a lane's source or a declared non-lane, and the
  CI row's When cell equals the phrases derived from `ci.yml`'s `on:`
  block; other lanes' triggers are not compared with `on:`, because the
  Copilot workflow lists `pull_request_target` while its job runs only
  on dispatch. `copilot-requested`: the `request` job admits a
  non-draft pull request, or the file carries a `PAUSED <date>` note
  directly above the job's `if:` that names an open tracker issue; a
  declared pause is green, and closing the issue with the job still
  dispatch-only is red. `copilot-never-blocks`: no other workflow
  mentions Copilot, none triggers on it with `workflow_run`, and no
  script names it. `tier-informs`: the readers of the tier are the
  declared list in `review-lanes.json`, found by code (imports and
  string literals in scripts, `run:` and `with:` in workflows, script
  values in `package.json`), a helper-only reader may take only
  `matchesPattern` and `patternFault`, and `.tier` is only printed.
- `npm run check:review-tiers` (a `ci.yml` step with no `if:` guard)
  keeps the routing table in step. It fails on a checklist heading or
  REVIEW.md title with no row, a row naming one that no longer exists, a
  heading or title declared twice, a glob matching no tracked file, a
  file-shaped glob leaving same-named files unreached, and a stale
  `reachAcknowledged` entry; it exits 2 when an input cannot be read or
  is malformed. It does not check that anyone reads the
  routing.
- `review-policy.md#copilot-requested`'s mechanism is
  `.github/workflows/copilot-review.yml`,
  whose shell runs against a stubbed `gh` in `gates-review.test.mjs` (the
  `test:scripts` step, `if: docs_only != 'true'`). Since 2026-10-19 the
  request job runs only on a manual dispatch, so neither
  `review-policy.md#copilot-requested` nor
  `review-policy.md#copilot-never-blocks`'s re-ask on the next push is
  carried out until someone restores its `if:` (barwise-ilb);
  `check:review-workflows` states the pause and goes red when the issue
  closes with the job still paused. Two
  exceptions to `review-policy.md#copilot-requested` have no deciding
  source: drafts are skipped until marked ready, and a failed
  read of the reviews or the request events stops the job red without
  requesting (barwise-m9q). Copilot reads hand-written modelling guidance, not the
  checklist (barwise-1040).
- `review-policy.md#copilot-never-blocks` holds that nothing in the tree
  waits on Copilot, and cannot hold that no required status or ruleset in
  repository settings does: that is invisible to a session
  (barwise-raw, barwise-ym8.8ya). The workflow fails its own run by
  design when a request does not land, so "cannot fail a run" is not the
  rule.
- `review-policy.md#review-md-owns-lanes` is held for the table and the CI
  row's trigger; that anyone runs a lane is not, with one exception:
  `review-policy.md#review-before-open` holds the author's `/code-review`
  before opening. Nothing records that `/security-review` ran
  (barwise-slv). A stacked pull request gets no
  CI until `main` is merged into it after its parent merges (`steward`
  section 4a). `pr-risk` does not route the `/security-review` triggers
  (barwise-16u).
- `review-policy.md#tier-informs` holds that nothing else keys on the
  tier. It does not hold the rest: nothing records that `pr-risk` ran on
  the reviewed head or that its groups were run. The opening guard
  records that the checklist was read on the proposed commit, which is
  less, and says so (`review-before-open.spec.md`, "What the record
  cannot see"). Printing the routing in CI was
  deferred by the owner on 2026-10-24 until reviewers are shown to use
  it (`review-routing.spec.md`, WS3; barwise-6mf).
- `review-policy.md#review-before-open` is held by two Claude Code
  hooks, in a session that loads `.claude/settings.json`
  (`review-before-open.spec.md` has the design and the measurements).
  `scripts/hooks/review-recorder.mjs` appends to the session's record
  when the `Skill` tool returns for `code-review` and when the `Read`
  tool returns the whole checklist to the main conversation, each with
  the commit `HEAD` names. `scripts/hooks/pr-open-guard.mjs` refuses
  `mcp__github__create_pull_request`, and one literal form of
  `gh pr create` in Bash, unless both entries are on the tip of the head
  branch as `git ls-remote` reports it; a fix after a review is a new
  commit and needs both again. A state it cannot read refuses with
  exit 2 (`gate-refusal-contract.md`). `pr-open-guard.test.mjs` plants
  each refusal (the `test:scripts` step).
- What that hook does not hold, each stated in the spec: that the review
  was acted on or the checklist applied; a session that loads no project
  hooks, or a person; the `gh` forms its parser does not see, which the
  test file pins as a list; a session that writes the record itself or
  adds the override line unasked (barwise-4q0); and
  `mcp__github__create_pull_request_with_copilot`, where no commit of
  the session exists to review. Nothing reads opened pull requests
  afterwards: the record lives in a session's temporary directory, and
  the body is text the author writes. An overridden opening still meets
  `merge-delegation.md#review-before-merge` before it merges, and the
  `pr-review` checklist asks the reviewer there whose instruction the
  line quotes.
- What reviews keep finding is prevented upstream: Copilot's findings
  are classified by failure mode and the most common one gets a mechanism
  in front of review; REVIEW.md's "Always check" list, drawn from a month
  of all reviews' findings, ranks the modes every review runs. This is a
  practice, not a rule a check can hold; it was decision 5 until
  2026-11-06 (`adr-refactor.spec.md`, row 25). The classification has had
  its seed pass and first mechanism; the pass that measures that mechanism is open
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
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5),
  `tiered-pr-review.spec.md`, `REVIEW.md`, the `copilot-review.yml` header, `review-tiers.json`, the
  `steward` (section 7), `pr-review` (section 3 and `checklist.md`) and
  `pr-creation` skills, `review-md.spec.md` and
  `review-routing.spec.md` also state this rule. Decision 5 is stated
  here and designed in its spec; `pr-creation` and the root `CLAUDE.md`
  point to it.
