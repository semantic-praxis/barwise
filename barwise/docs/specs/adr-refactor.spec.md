# ADR refactor: each decision enforced, restated, or retired to prose

Status: Draft -- no workstream implemented

Created: 2026-11-05
Last-updated: 2026-11-05
Tracking: barwise-ym8.gc9 (follows docs/specs/enforceable-adr-practice.spec.md)
Touches: barwise/docs/adr/, barwise/docs/ARCHITECTURE.md, .beads/issues.jsonl,
barwise/docs/adr/probes.json

## Principle

An ADR's numbered decision is a rule other work must follow, and its
`Enforced-by:` header says what holds it. After the enforceable-adr-practice
work, every decision is accounted for, but most are held by a gap issue
alone: on main (after #931) 87 decisions, 13 with a gate, 31 held by
tests and no gate, 43 by `none` only, 85 carrying a gap issue. A gap
issue is honest, not enforcement. Each one's acceptance clause, set by
the owner on 2026-10-31, names three ways to close it: an enforcer that
fails on a violation, a restatement a check can see, or retirement of
the decision to prose guidance. This spec sorts all 85 and plans the
work. It serves "explicit over implicit": a decision nothing can check
reads as a rule and is followed as guidance, which is the worst of both.

## The sort

Each decision is classed by kind, which predicts its outcome (the
sorting key in barwise-ym8.gc9's notes): an **invariant** is a property
of code or files, and is buildable when a violation is an edit some
check could read; a **procedure** is who does what when, and is
buildable only when an event record exists (a merge's arguments, a
commit, a workflow trigger), else it needs restating; a **judgment** is
criteria for a choice, and retires to prose.

| Kind      | Buildable | Restate | Retire | Total |
| --------- | --------- | ------- | ------ | ----- |
| invariant | 54        | 7       | 0      | 61    |
| procedure | 6         | 11      | 0      | 17    |
| judgment  | 0         | 0       | 7      | 7     |
| total     | 60        | 18      | 7      | 85    |

The sort was made on 2026-11-05 from each decision's text and its gap
issue's "Unguarded" clause, reading the gate a clause names where the
call depended on it, then corrected in plan review (readable-iri,
one-layer-out, measurement-key). The two other open adr-gap issues,
barwise-ym8.r6i and barwise-ym8.sit, name the determinism-in-core
decisions #931 removed; they close in that PR's tracker follow-up and
are not sorted here (r6i's positive half, that each surface installs an
id generator, went with the retired generators). 27 calls are low confidence, marked `(low)` below;
most wait on an owner choice, not on a fact:

- an earlier owner choice would need reopening:
  `plan-before-code#spec-first` and `#touches-named` (plan-scope never
  fails, by decision), `review-policy#copilot-requested` (whether the
  2026-10-19 pause is permanent), `keyless-model-access#measurement-key`,
  `schema-versioning#minor-and-major`;
- no record exists to check: three `merge-delegation` procedures
  (review-before-merge, no-size-exemption, owner-overrides; barwise-zdd,
  barwise-4q0: the driving agent's review is not posted and every merge
  shows the owner's login), `review-policy#review-md-owns-lanes`
  (barwise-953), `findings-close-by-mechanism#mechanism-closes`;
- the rest: whether a proposed restatement is acceptable or feasible.

The inventory at the end lists every decision with its call. It is a
proposal: the owner's review in WS1 is what fixes it.

## Shared enforcers

Twenty groups of decisions share one enforcer or one existing issue, so
one change closes several gaps. The largest: fault-matrix in CI
(`gate-refusal-contract` three-results, refuse-not-find, cwd-invariant,
no-writes); `check:python-uv` widening (all five
`python-from-the-lockfile` decisions; barwise-cpu, barwise-c81);
baseline writers through `baseline-merge.mjs` (three
`baselines-merge-on-write` decisions and `person-classifies`;
barwise-tko); a capability-matrix check (all four
`surface-capability-parity` decisions; barwise-1005, barwise-xpt); a
pins check (all three `pinned-runtimes` decisions; barwise-920); the
merge hook (the three `merge-delegation` procedures that need a merge
record; barwise-zdd), beside `pinned-merge`, buildable from the merge
call's own arguments.

## Scope

In scope:

- When the owner accepts a retirement, the decision shall leave the
  Decision section, its guidance shall stay in the ADR as prose under
  Context or Consequences, its `none` entry shall leave the header, its
  gap issue shall close, and the ADR's `Date:` shall move, all in one
  PR: the ADR's decisions changed (`architecture-index.spec.md`, "Date:
  is when the decision last changed").
- When a retirement renumbers the decisions after it, the same PR shall
  update every reference to those decisions by number, found by
  searching the tree for the ADR's name with "decision"; no gate checks
  numbered references (`check:architecture` resolves ADR names only),
  and at least `merge-delegation.md`, `must-agree-copies.md` and
  `halpin-morgan-3e-reading-guide.md` cite decisions by number today.
- When the owner accepts a restatement, the decision's text shall change
  to the restatement, its `Date:` shall stay (a restatement says the
  same rule), and its gap issue's Unguarded clause shall be rewritten
  against the new text; it is then re-sorted, usually to buildable.
- A proposed restatement that would change what the decision decides is
  marked **changes the decision** in the inventory (four rows:
  `trust-statement`, `owner-overrides`, `four-filters`,
  `peer-standard`). WS1 offers the owner a restatement that keeps the
  rule, or a change of the decision as its own ADR edit, never the
  changing text as a restatement.
- When an enforcer is built for a decision, the PR shall follow the
  authoring step (`spec-writer/adr-writing.md`): plant a violation, see
  the enforcer exit 1, add the `npm` or `tests` entry, add a
  `probes.json` row for a gate, and narrow or close the gap issue.

Out of scope: changing what a decision decides. A restatement says the
same rule so a check can see it; a decision the owner wants changed is
its own ADR edit, outside this spec. Fixing the known violations gap
issues cite (barwise-c3z, barwise-dko, barwise-uam and the like) is the
work of those issues; this spec builds the checks that would catch them.

## Workstreams

### 1. Owner review of the 18 restatements and 7 retirements

Text only, no code. The 25 rows go to the owner as one table, grouped by ADR, each with the decision's current text and the
proposed restatement or the reason it is judgment. The owner accepts,
rejects (the row is re-sorted), or edits each. Accepted rows land as ADR
edits in batches of a few ADRs per PR, regenerating `ARCHITECTURE.md`.
First because it is cheap, needs only the owner's time, and changes what
the later batches build: a restatement accepted here usually becomes a
buildable row.

#### WS1 proposals

Each row: the decision, what is proposed, and the replacement text or
where the prose goes. "Changes" marks a row where the inventory's first
proposal would have changed the rule; the proposal here does not, or
says so. The owner answers per row: accept, reject, or edit.

Restatements (the rule stays; `Date:` stays):

1. `connector-packages#descriptor-wraps-core`: **owner, 2026-11-06:
   the decision changes**, so it leaves WS1 for a spec of its own.
   `renderDdl`, `renderOpenApi` and `renderAvro` move to
   `@barwise/formats` and `renderDbt` to `@barwise/dbt`;
   `RelationalMapper` stays in core (ORM is relational). `@barwise/dbt`
   depends on `@barwise/formats`, and one SQL-parsing function there
   (the sqlglot bridge with the regex fallback) replaces the copy in
   each importer, by composition, not inheritance; whether
   `parseSqlFile` leaves core with it is settled in that spec. The
   `pascal-case-avro`, `pascal-case-openapi` and `sqlglot-bridge`
   parity sets go with the copies.
2. `credential-handling#rotate-not-revert`: "Every message `check:secrets`
   and the pre-commit hook print on a finding names rotation in the
   provider console as the remedy, and none suggests rewriting history."
3. `determinism-in-core#one-layer-out`: "Outside core, only
   `@barwise/llm` imports a model SDK, and a format's own file and
   subprocess I/O lives in its connector package; anything else that
   cannot be deterministic lives in the tool layer (`cli`, `mcp`,
   `vscode`)." Note for the owner: `learn` and `promptlab` read files,
   the clock and the environment today and the decision does not name
   them; saying where they belong would change the decision, so it is a
   separate ADR edit if wanted.
4. `findings-close-by-mechanism#mechanism-closes`: "An issue filed from
   an audit finding is closed with a reason naming the check or the
   baseline row that holds it, and that file is in the tree." Low
   confidence: no label marks a finding issue today, so a check needs
   one (a convention this restatement would add).
5. `findings-close-by-mechanism#person-classifies`: "A baseline writer
   never sets a verdict: a new row gets the placeholder, and a row
   already classified keeps its verdict."
6. `keyless-model-access#measurement-key`: keep the first sentence;
   move "That key must be a workspace-scoped key with a spend limit,
   never a personal one" to Consequences as operator guidance, since the
   key's scope lives in the provider console, outside the tree. The
   decision then states only what the tree can show: the measurement
   lane is the one place that reads a key.
7. `merge-delegation#review-before-merge` (owner: restate): "Before the
   agent driving a pull request merges it, a comment on the pull request
   names the head being merged and the `pr-review` recommendation of
   `merge` on that head; 'merge after', 'do not merge' and 'cannot tell'
   do not license a merge, nor does a review run where `/code-review`
   was unavailable."
8. `merge-delegation#no-size-exemption`: "Decision 1's comment is
   required on every pull request, tracker-only and docs-only included."
9. `merge-delegation#owner-overrides` (changes, first proposal dropped
   the owner's override): "When the owner says to merge a pull request,
   the agent merges it, and its merge comment says the owner directed
   the merge. A reviewer who is not the driving agent recommends, and
   never approves or merges."
10. `metamodel-evolution-policy#recompute-derived`: "The `.orm.yaml`
    schema defines no property for relational mapping, DDL or any other
    rendered output, and the serializer writes none; each is recomputed
    from the conceptual model."
11. `must-agree-copies#check-on-copy`: "Every `audit:duplication`
    candidate's verdict names its check (a shared owner, a derivation, a
    `parity.manifest.json` entry, or a drift test) or a benign reason."
    Low confidence: this restates through the audit, which sees only
    the copies its detectors find.
12. `ossie-interchange#peer-standard` (changes, first proposal dropped a
    clause): keep the checkable part as the decision ("core names
    nothing specific to Ossie, and Ossie documents enter and leave only
    through the `ossie` descriptor in `@barwise/formats`"), and move "an
    idea from Ossie enters barwise because it serves barwise, never only
    because Ossie has it" to Context as the reasoning, since it is the
    judgment the metamodel filters apply.
13. `ossie-interchange#own-vocabulary`: "Only `formats/src/ossie`
    imports Ossie's types, `mapOssieToOrm.ts` or `writeOssie.ts`; barwise
    keeps its ORM 2 terms, and the construct-by-construct translation is
    the spec's Scope."
14. `plan-before-code#spec-first`: "A pull request that changes package
    source names the spec it implements, in its body or a commit
    message." Owner choice: plan-scope never fails by decision, so this
    needs that choice reopened; with no exemption line, a small fix
    needs a spec too, which is the rule as written.
15. `plan-before-code#open-decisions-reviewer`: "Every spec has an Open
    decisions section, and each entry gives its options, the trade-off
    and a recommended default."
16. `review-policy#review-md-owns-lanes`: "`REVIEW.md`'s lane table
    lists each review lane and when it runs, and no other file states
    when a lane runs."

Proposed as retirements instead of restatements (no restatement keeps
the rule and is checkable):

17. `constraint-coverage-policy#trust-statement` (changes, first
    proposal added a feature): it says how a reader treats extracted
    constraints, which is guidance to consumers. Move to Consequences.
18. `metamodel-evolution-policy#four-filters` (changes, first proposal
    checked existing constructs instead of candidates): criteria for
    admitting a construct are judgment. Move to Context as the filters
    a candidate is weighed against.

Retirements (judgment; the text moves to prose, `Date:` moves, later
decisions renumber and their numbered references are updated):

19. `constraint-coverage-policy#compares-not-certifies`: to Context.
20. `merge-delegation#ask-owner`: to Consequences, as when the driving
    agent asks instead of merging. Low confidence: "after two reviews
    that did not recommend merge" could be read from the comments
    decision 1 now requires; if the owner prefers, it stays a decision
    and moves to batch 10.
21. `metamodel-evolution-policy#deliberately-lossy`: to Context.
22. `metamodel-evolution-policy#tiering`: to Context, beside the tiers.
23. `metamodel-evolution-policy#design-against-book`: to Context.
24. `must-agree-copies#check-first`: **owner, 2026-11-06: the
    decision changes**, with row 1. The default becomes: share where
    sharing does not couple packages that should not know each other,
    by composition (a function both sides call) rather than
    inheritance, and add a parity check only where sharing would
    couple them. A separate ADR edit; leaves WS1.
25. `review-policy#prevent-upstream`: to Consequences.

If every row is accepted, `metamodel-evolution-policy` keeps one
decision (recompute-derived) and `constraint-coverage-policy` three.

### 2 to 10. Buildable batches

Each batch is designed in its own section of this spec, plan-reviewed,
before any code, because each is a real change to gates or tests. The
inventory tags every buildable row with its batch; the counts sum to the
60 buildable rows. Order, most decisions per enforcer and high
confidence first:

2. Gate contract (`gate-refusal-contract`, 5): fault-matrix with more
   axes (missing tool, manifest, shallow clone, a file-hash watch for
   writes) and the `ci:local` mixed-result test; check-depcruise-gate's
   probe write (barwise-w43) fixed first. Wiring it into CI is open
   decision 2.
3. `check:python-uv` widening (`python-from-the-lockfile`, 5).
4. Baseline and ratchet writers (`baselines-merge-on-write`, and the
   buildable rows of `findings-close-by-mechanism` and
   `must-agree-copies`, 9): through `baseline-merge.mjs`, a verdict
   vocabulary (barwise-u5d), a ratchet registry.
5. Capability matrix (`surface-capability-parity`, 4).
6. Credential and runtime pins (`credential-handling`,
   `pinned-runtimes`, 7): `.gitleaks.toml` and wrapper tests, a pins
   check (barwise-920).
7. Keyless and prompt resolution (`keyless-model-access`,
   `production-prompt-resolution`, 8): the CLI option inventory
   (barwise-xsg, barwise-qxt), the VS Code key setting (barwise-ybi).
8. Purity and connector boundaries (`connector-packages`,
   `determinism-in-core#pure-ops`, 4): purity's patterns
   (barwise-fzd), a core-no-interop check, per-surface registration
   tests.
9. Schema, Ossie, eval suite and package graph (`schema-versioning`,
   `ossie-interchange`, `constraint-coverage-policy`,
   `package-graph-authority`, 12).
10. Process gates (`merge-delegation#pinned-merge`, two
    `plan-before-code` and three `review-policy` rows, 6): each reads
    an event record that exists (a merge's arguments, a branch's
    commits, a workflow's trigger).

Each batch closes or narrows its gap issues and adds its probes. A batch
whose enforcer turns out not to discriminate (the probe reads MISSED)
goes back to the sort, not into the header.

## Open decisions (for review)

1. **Order.** Resolved 2026-11-05 by the owner: WS1 first, since
   restatements change what gets built and it costs only review time.
2. **fault-matrix in CI.** Batch 2 holds four decisions only if
   fault-matrix runs in CI; today it is on demand by design
   (`gate-refusal-contract.spec.md`). Recommended: decide in batch 2's
   design, with its runtime measured.
3. **merge-delegation.** Resolved 2026-11-05 by the owner: restate.
   Three of its rows (review-before-merge, no-size-exemption,
   owner-overrides) need a merge record that does not exist
   (barwise-zdd), and retiring them is not on offer, since CLAUDE.md
   delegates the merge rule to them (steward, section 4b). WS1 restates
   them as what review can see; `pinned-merge` stays buildable (batch
   10), and `ask-owner` is a retirement.
4. **The five owner choices** listed under the sort: each is the owner's
   to reopen or leave; leaving one means it is restated or retired, not
   built.

## Inventory

One line per decision with a gap issue: id, gap issue, kind, proposed
outcome, `(low)` for a low-confidence call, its workstream (WS1 or a
batch), and the violation (buildable,
with its proposed enforcer), the restatement, or why it is judgment.

**baselines-merge-on-write**

- `merge-not-regenerate` (barwise-ym8.fi5) -- procedure, **buildable**, batch 4: the trial-gate writer keeps undetected rows, or the rubric writer test skips in CI; enforcer: make the audit-rubric writer test refuse rather than skip (build promptlab first in test:scripts) and route trial/lib/gate.mjs --write through baseline-merge.mjs with its own round-trip test.
- `one-merge-owner` (barwise-ym8.3yv) -- invariant, **buildable**, batch 4: a baseline writer that merges rows without importing scripts/lib/baseline-merge.mjs; enforcer: script test over a registry of baseline files and their writers asserting each writer imports baseline-merge.mjs (catches trial gate and expected-counts writer).
- `specs-write-on-ask` (barwise-ym8.6jy) -- invariant, **buildable**, batch 4: audit:specs without --write rewrites the baseline, or --write stops writing; enforcer: gates.test.mjs case over a stale, unsorted fixture baseline: bare run leaves bytes unchanged, --write changes them.
- `findings-order` (barwise-ym8.nhy) -- invariant, **buildable**, batch 4: a writer that reorders rows after the merge or drops the helper's printed summary; enforcer: per-writer output test asserting id order and the summary line, including kept-versus-reopened counts and the trial gate.
- `duplication-no-writer` (barwise-ym8.79m) -- invariant, **buildable**, batch 4: audit:duplication writes its baseline through any fs API; enforcer: replace the writeFileSync text check with a run-and-compare test (baseline bytes and git status before and after).

**connector-packages**

- `core-no-interop` (barwise-ym8.paz) -- invariant, **buildable**, batch 8: core/src defines a format adapter for a connector to register; enforcer: new check (in check-core-purity or a core test) listing core/src values typed, implementing or satisfying ImportFormat/ExportFormatAdapter and failing on any.
- `connector-owns-io` (barwise-ym8.iyw) -- invariant, **buildable**, batch 8: an I/O import purity's regexes miss, or a surface calling a connector's I/O function directly; enforcer: extend purity's patterns (named node:process, createRequire, worker_threads, readline, dns, comment-led imports, dynamic import, require, cwd, fetch) and add a depcruise rule forbidding surfaces from importing connector I/O entry points such as importDbtProject.
- `descriptor-wraps-core` (barwise-ym8.y5z) -- invariant, **restate** (low), WS1: each descriptor for a format core can render or parse imports and calls that named core function (table: ddl->renderDdl, openapi->renderOpenApi, ...).
- `explicit-registration` (barwise-ym8.2n3) -- invariant, **buildable**, batch 8: a surface's entry point that omits a register*Formats() call; enforcer: per-surface test booting the real registration path (CLI main, MCP server, extension activate) with no test-side registration and pinning the registry's format ids with toEqual.

**constraint-coverage-policy**

- `trust-statement` (barwise-ym8.fmt) -- procedure, **restate** (low), WS1, **changes the decision**: extracted constraints of a type without two rubric-tested instances carry an 'unreviewed' marker or warning in the import result.
- `compares-not-certifies` (barwise-ym8.nzv) -- judgment, **retire**, WS1: no check can tell a certification claim from a comparison in free text.
- `two-instances` (barwise-ym8.5yl) -- invariant, **buildable** (low), batch 9: a type marked covered with one instance, or two in one split or domain; enforcer: promptlab suite test counting rubric-tested instances per constraint type by split and domain, checked against the inventory.
- `tiered-types` (barwise-ym8.vq8) -- invariant, **buildable**, batch 9: an eval transcript or rubric that tests a rare-tier type; enforcer: promptlab suite test failing on any rubric constraint of a rare-tier kind.
- `inventory-outside` (barwise-ym8.k6g) -- invariant, **buildable**, batch 9: an eval instance added without the inventory edit; enforcer: drift test comparing docs/specs/constraint-extraction-coverage.spec.md's inventory table with counts derived from the suite.

**credential-handling**

- `rotate-not-revert` (barwise-ym8.yhs) -- procedure, **restate** (low), WS1: every message check:secrets and the pre-commit hook print on a finding says rotate, none suggests history rewriting, and a refusal does not say rotate.
- `gitleaks-detects` (barwise-ym8.7zs) -- invariant, **buildable**, batch 6: a second [[rules]] entry in .gitleaks.toml; enforcer: script test parsing .gitleaks.toml and asserting exactly the one Anthropic rule.
- `scan-index-and-history` (barwise-ym8.kf3) -- invariant, **buildable**, batch 6: removing the check:secrets CI step, giving it a docs-only guard, or dropping --staged from pre-commit; enforcer: script test reading ci.yml and .husky/pre-commit asserting the unguarded step and the --staged call.
- `wrapper-contract` (barwise-ym8.gc7) -- invariant, **buildable**, batch 6: the wrapper exits other than 2 when gitleaks fails to spawn, or omits --verbose; enforcer: two check-secrets tests: spawn-error refusal and --verbose in argv.
- `pinned-gitleaks` (barwise-ym8.nxs) -- invariant, **buildable**, batch 6: ci.yml or the session hook installing gitleaks another way or naming another version; enforcer: script test that ci.yml and the session hook call install-gitleaks.sh and name no gitleaks version, plus a run of the installer with a wrong SHA that must fail before unpacking.

**determinism-in-core**

- `pure-ops` (barwise-ym8.lxl) -- invariant, **buildable**, batch 8: fetch, performance.now, process.cwd, dynamic import, node:dns, named crypto randomness, locale-default ordering or formatting, or cwd-relative paths in core/src; enforcer: extend check-core-purity patterns (with probes in adr-probes).
- `one-layer-out` (barwise-ym8.kys) -- invariant, **restate** (low), WS1: restatement to draft in WS1: purity's ambient patterns cannot simply widen, since learn and promptlab already read fs, the clock and process.env by design; the restatement must name which packages may, which the decision does not say today.

**findings-close-by-mechanism**

- `mechanism-closes` (barwise-ym8.1b2) -- procedure, **restate** (low), WS1: a closed finding issue's close reason names a check file or baseline row that exists in the tree.
- `ratchet-both-ways` (barwise-ym8.k4d) -- invariant, **buildable**, batch 4: a ratchet that silently keeps a stale baseline row; enforcer: stale-row tests for audit:duplication, audit:specs and audit:rubric, plus a ratchet registry test requiring both directions for each listed ratchet.
- `person-classifies` (barwise-ym8.h0l) -- procedure, **restate** (low), WS1: a writer fills only the placeholder for new ids, and every ratchet validates verdicts against one vocabulary with tracked:<issue> resolved.
- `ratchet-in-ci` (barwise-ym8.ld2) -- invariant, **buildable**, batch 4: an audit with a --check ratchet and no ci.yml step; enforcer: check:architecture-style test pairing every ratchet in a registry with a ci.yml step (trial:gate included).

**gate-refusal-contract**

- `three-results` (barwise-ym8.j31) -- invariant, **buildable**, batch 2: a gate printing PASS or exit 1 on its own refusal, or exit 2 on a finding; enforcer: run fault-matrix in CI and extend it to every gate importing tracked.mjs and every ci.yml npm step.
- `refuse-not-find` (barwise-ym8.rl7) -- invariant, **buildable**, batch 2: a gate exiting 1 on a missing input; enforcer: add missing-tool, manifest, lockfile and shallow-clone axes to fault-matrix and run it in CI.
- `cwd-invariant` (barwise-ym8.c42) -- invariant, **buildable**, batch 2: a gate whose result changes with cwd; enforcer: run fault-matrix's cwd axis in CI over every gate.
- `readers-keep-third` (barwise-ym8.aep) -- invariant, **buildable**, batch 2: ci:local or the pre-commit hook folding a refusal into the failures, or a test skipping on one refusing run; enforcer: ci:local test planting one failing and one refusing gate, a pre-commit hook test over a check:secrets refusal, and a skip-rule test.
- `no-writes` (barwise-ym8.if3) -- invariant, **buildable**, batch 2: a gate writing into the tree it reads (check-depcruise-gate's probe); enforcer: fault-matrix's porcelain axis in CI, strengthened with a file-hash watch so a write undone before exit is seen.

**keyless-model-access**

- `no-key-in-argv` (barwise-ym8.4gl) -- invariant, **buildable**, batch 7: a command declaring a key option under another name; enforcer: CLI test walking all commands' options and refusing names matching key/token/secret, replacing the --api-key spelling match.
- `no-key-in-setting` (barwise-ym8.nw4) -- invariant, **buildable**, batch 7: a vscode call site reading anthropicApiKey other than through getAnthropicApiKey; enforcer: lint rule or test grepping vscode/src for the setting key outside the helper, a package.json scope assertion, and a migration test on the Copilot path.
- `keyless-defaults` (barwise-ym8.52o) -- invariant, **buildable**, batch 7: an MCP registration that stops passing the resolved client, or llmProvider defaulting off copilot; enforcer: remove or test the createLlmClient fallback in tools/import.ts and tools/review.ts, and assert barwise.llmProvider's default in package.json.
- `measurement-key` (barwise-ym8.esi) -- procedure, **restate** (low), WS1: the key's scope and spend limit live in the provider console, not the tree; restate to what the repo can see (which variable the lane reads, and that nothing else reads it), the rest as prose.
- `library-takes-key` (barwise-ym8.dxy) -- invariant, **buildable**, batch 7: a provider or createLlmClient dropping the apiKey; enforcer: factory and provider tests asserting the key reaches the SDK constructor for every provider.

**merge-delegation**

- `review-before-merge` (barwise-ym8.2ds) -- procedure, **restate** (low), WS1: a merge is refused unless a recorded pr-review recommendation of merge names the head SHA.
- `pinned-merge` (barwise-ym8.vl9) -- procedure, **buildable**, batch 10: a merge without expectedHeadSha or --match-head-commit, or with no SHA comment after; enforcer: PreToolUse hook on gh pr merge and the MCP merge tool requiring the pin (barwise-zdd), plus a closed-PR workflow checking the SHA comment.
- `no-size-exemption` (barwise-ym8.2vy) -- procedure, **restate** (low), WS1: the merge hook applies to every PR with no path-based exemption.
- `ask-owner` (barwise-ym8.oof) -- judgment, **retire** (low), WS1: no artifact records 'the review could not tell' or an open owner decision.
- `owner-overrides` (barwise-ym8.n0m) -- procedure, **restate** (low), WS1, **changes the decision**: a merge by an agent carries a trailer or comment identifying the driving session, and a non-driving reviewer's session cannot merge.

**metamodel-evolution-policy**

- `deliberately-lossy` (barwise-ym8.qpz) -- judgment, **retire**, WS1: no artifact records why a construct earned its place.
- `four-filters` (barwise-ym8.gfk) -- invariant, **restate** (low), WS1, **changes the decision**: every construct in orm-model.schema.json appears in a round-trip fixture and yields a verbalization.
- `tiering` (barwise-ym8.26v) -- judgment, **retire**, WS1: no artifact records a construct's tier.
- `design-against-book` (barwise-ym8.e05) -- judgment, **retire**, WS1: nothing in the tree records the source a design followed.
- `recompute-derived` (barwise-ym8.3ai) -- invariant, **restate** (low), WS1: the serializer never writes RelationalMapper or render* output, and the schema defines no property of those types.

**must-agree-copies**

- `check-on-copy` (barwise-ym8.edf) -- invariant, **restate** (low), WS1: every audit:duplication verdict names a parity entry or drift test, or a benign reason from a fixed list.
- `check-first` (barwise-ym8.3tg) -- judgment, **retire**, WS1: no artifact records the choice between sharing and checking.
- `registered-sets-identical` (barwise-ym8.8nq) -- invariant, **buildable**, batch 4: an unknown ignore value, a set of one, or a manifest entry deleted while both copies remain; enforcer: extend check:parity to validate ignore values and set size, and ratchet manifest entries against a baseline.
- `every-candidate-verdict` (barwise-ym8.onf) -- invariant, **buildable**, batch 4: a verdict outside the vocabulary, or tracked:<issue> naming no open issue; enforcer: audit:duplication --check validating verdicts against an enum and resolving tracked ids in .beads/issues.jsonl (barwise-u5d).

**ossie-interchange**

- `peer-standard` (barwise-ym8.zec) -- invariant, **restate**, WS1, **changes the decision**: core/src names nothing Ossie, and only formats/src/ossie reads Ossie documents or the vendored schema.
- `ontology-layer-only` (barwise-ym8.k74) -- invariant, **buildable**, batch 9: the importer reading datasets/fields/metrics, or the exporter writing core-layer or mapping content; enforcer: tagged tests with an Ossie fixture carrying core-layer content, and a schema check that exported documents hold only ontology-layer keys.
- `pinned-version` (barwise-ym8.oor) -- invariant, **buildable**, batch 9: vendored schema drifting from commit 01a5488d, or the importer validating against another schema; enforcer: test hashing formats/schemas/ossie/ against a recorded manifest for the commit, and a tagged importer test that validation uses the vendored files.
- `nothing-lost-silently` (barwise-ym8.zkd) -- invariant, **buildable**, batch 9: an exporter loss with no loss-block entry or warning; enforcer: tag the existing unit tests and add a property test over generated models asserting mapped-or-reported for each construct.
- `readable-iri` (barwise-ym8.m1l) -- invariant, **buildable** (low), batch 9: the sort read the gap issue before iri-identity was marked built (barwise-wcg.vlv brings it current); a stored element id that is not a readable local name in its namespace; enforcer: to design, likely a validation rule over the 4.0 reader's ids.
- `own-vocabulary` (barwise-ym8.yc6) -- invariant, **restate** (low), WS1: only formats/src/ossie imports Ossie types or the mapper, and a listed set of Ossie terms is absent from core, cli and docs.

**package-graph-authority**

- `intended-is-graph` (barwise-ym8.d3m) -- invariant, **buildable**, batch 9: a script with its own package list, or a package CLAUDE.md dependency rule disagreeing with INTENDED; enforcer: extend check:architecture to compare per-package CLAUDE.md dependency rules with INTENDED and to flag scripts declaring package-graph literals without requiring intended.cjs.

**pinned-runtimes**

- `node-from-nvmrc` (barwise-ym8.q89) -- invariant, **buildable**, batch 6: a workflow naming a literal Node version, or .nvmrc disagreeing with engines.node or README; enforcer: check:pins (barwise-920): workflows use node-version-file, .nvmrc paired with engines.node and README in check:parity.
- `python-minor` (barwise-ym8.52y) -- invariant, **buildable**, batch 6: uv sync/run choosing an interpreter other than .python-version's minor; enforcer: move or add .python-version where uv finds it and a check comparing uv's chosen interpreter and uv.lock's single resolution with the pin.
- `verify-running` (barwise-ym8.eq3) -- invariant, **buildable**, batch 6: a gate run on a Node or Python other than the pinned one with no refusal; enforcer: ci:local and test:coverage read back node and python versions against .nvmrc and .python-version and refuse (exit 2) on mismatch.

**plan-before-code**

- `spec-first` (barwise-ym8.yg7) -- procedure, **restate** (low), WS1: a PR changing package source names a spec or carries an explicit no-spec line.
- `plan-reviewed` (barwise-ym8.ogi) -- procedure, **buildable**, batch 10: a PR implementing a merged spec's Touches: paths with no Plan-reviewed: line; enforcer: extend check:plan-review to match diffs against merged specs' Touches:, validate reviewer names, and compare later plan edits.
- `touches-named` (barwise-ym8.8hq) -- invariant, **buildable** (low), batch 10: a change touching paths its spec's Touches: does not list; enforcer: plan-scope --check mode wired into CI.
- `open-decisions-reviewer` (barwise-ym8.l7d) -- procedure, **restate** (low), WS1: every spec has an Open decisions section whose entries each give options, a trade-off and a default.

**production-prompt-resolution**

- `shipped-only` (barwise-ym8.mdg) -- invariant, **buildable**, batch 7: selectArtifact reading candidates from an environment variable or user config directory; enforcer: test running selectArtifact with planted env and temp config dirs, and tagged call-site tests asserting no artifact is passed.
- `candidates-in-prompt-lane` (barwise-ym8.w0p) -- invariant, **buildable**, batch 7: a production command taking a candidate through another option name, a hidden option or an env var; enforcer: test enumerating all options of import transcript, review and import batch against a deny pattern, plus MCP input-schema and VS Code equivalents.
- `recovered-not-recorded` (barwise-ym8.x2g) -- invariant, **buildable**, batch 7: a call-log record gaining artifactVersion; enforcer: tag or add a test asserting the record has no artifactVersion.
- `library-seam` (barwise-ym8.29c) -- invariant, **buildable**, batch 7: processTranscript or reviewModel bypassing the guard for an explicit artifact; enforcer: tagged test passing an explicit artifact to each and asserting the guard runs.

**python-from-the-lockfile**

- `lockfile-only` (barwise-ym8.fq7) -- invariant, **buildable**, batch 3: a uv call after a global option, in an unscanned file, or with --frozen only in CI; enforcer: check:python-uv parsing uv global options, scanning package.json scripts, Makefile, .husky and .beads hooks, checking per call, and requiring --locked in workflows.
- `no-outside-forms` (barwise-ym8.l69) -- invariant, **buildable**, batch 3: -w, a banned flag after a global option, --with= in an array, or uv in a .py subprocess; enforcer: extend python-uv-rules.mjs (alias -w, global-option parsing, prefix match in arrays, .py string scan).
- `project-ancestor` (barwise-ym8.q07) -- invariant, **buildable**, batch 3: a script running uv from above barwise/ without --project, or pyproject.toml moved; enforcer: check:python-uv rule for --project outside barwise/ and a test that barwise/pyproject.toml is the only one.
- `groups-and-one-offs` (barwise-ym8.usv) -- invariant, **buildable**, batch 3: a second pyproject.toml, requirements*.txt or setup.py in the tree; enforcer: check:python-uv listing tracked Python manifests and failing on any but barwise/pyproject.toml (the outside-the-repo clause goes to prose).
- `uv-bootstrap` (barwise-ym8.suc) -- invariant, **buildable**, batch 3: a second bare bootstrap line, a command chained onto it, or an unpinned uv in the session hook; enforcer: exact-line allowlist with no chaining in check:python-uv and a pinned uv version check on the session hook.

**review-policy**

- `copilot-requested` (barwise-ym8.7y6) -- procedure, **buildable** (low), batch 10: the Copilot request job running only on workflow_dispatch; enforcer: workflow test asserting the job triggers on pull_request with the draft and failed-read exceptions declared.
- `copilot-never-blocks` (barwise-ym8.8ya) -- invariant, **buildable** (low), batch 10: a required status or job that waits on or fails with Copilot; enforcer: workflow test that no job needs the Copilot job and it cannot fail a run, plus an optional gh api read of branch protection.
- `review-md-owns-lanes` (barwise-ym8.f9u) -- procedure, **restate** (low), WS1: REVIEW.md's lane table lists every lane, and pr-risk routes every trigger it names.
- `tier-informs` (barwise-ym8.ehz) -- procedure, **buildable** (low), batch 10: a gate or workflow other than pr-risk reading the risk tier; enforcer: script test scanning workflows and scripts for tier reads outside pr-risk.
- `prevent-upstream` (barwise-ym8.gwj) -- judgment, **retire**, WS1: no artifact records that the most common failure mode got a mechanism.

**schema-versioning**

- `version-signal` (barwise-ym8.4i2) -- invariant, **buildable**, batch 9: reading a .orm.yaml without orm_version silently, or writing one outside the serializer; enforcer: tagged test for the missing-version read, and a lint/grep test for .orm.yaml writes outside the serializer.
- `minor-and-major` (barwise-ym8.31z) -- invariant, **buildable** (low), batch 9: a migration chain skipping a minor, or CURRENT_ORM_VERSION bumped without the schema const; enforcer: test that migration steps form a contiguous chain to CURRENT and parity between CURRENT_ORM_VERSION and the schema const.
- `shared-minor` (barwise-ym8.8l3) -- invariant, **buildable** (low), batch 9: orm-model.schema.json changed while CURRENT_ORM_VERSION equals the last released version; enforcer: CI check comparing the schema with the last release tag (barwise-vvg).
- `load-forward` (barwise-ym8.yfi) -- invariant, **buildable**, batch 9: a surface rewriting an older-version file on read without an edit; enforcer: per-surface tests reading a 3.x file through each read-only path and asserting bytes unchanged, plus a merge test that the merge ran.

**surface-capability-parity**

- `matrix-records-reach` (barwise-ym8.wfy) -- invariant, **buildable**, batch 5: a matrix row disagreeing with registrations, or a Divergence label outside the decision's vocabulary; enforcer: check parsing the CLAUDE.md matrix against the MCP and VS Code pinned lists and the CLI command tree, validating labels (barwise-1005, barwise-xpt).
- `matrix-same-commit` (barwise-ym8.3nm) -- procedure, **buildable**, batch 5: a tool added to code and its pinned list with the matrix unchanged; enforcer: the matrix-versus-code check run in CI on every commit.
- `vscode-yes-means` (barwise-ym8.0hi) -- invariant, **buildable** (low), batch 5: a VS Code yes with no palette command or LM tool, or pickers offering a subset of registered formats; enforcer: the matrix check plus a VS Code picker-versus-registry test (barwise-i22).
- `pinned-tool-lists` (barwise-ym8.0pq) -- invariant, **buildable**, batch 5: one surface's tool-list test deleted or untagged, or using arrayContaining; enforcer: extend check:adr-tests to require a tagged test per surface and a full toEqual over the list.
