# <Title: what this change achieves>

Status: Draft -- no workstream implemented

<!-- A claim about the SPEC, never about a pull request. The old default
read "design only -- no implementation in this PR", which is true for
exactly one merge and false forever after: two specs carried it through
their own workstreams shipping. Update this line in the commit that
lands a workstream, saying what shipped and what did not.
`npm run audit:specs -- --check` fails when a spec still claims nothing
was built while commits have touched the source it names (barwise-910). -->

Created: <YYYY-MM-DD>
Last-updated: <YYYY-MM-DD>
Tracking: barwise-<id> (or: REPO_REVIEW-<YYYY-MM-DD>.md finding #<n>)
Touches: <repo-rooted paths this plan changes, comma-separated; +path for
a file it creates, -path for one it deletes, a trailing / for a directory>

<!-- Touches: is the plan's machine-read file list. audit:specs reads it
instead of inferring a subject from every backticked path (so a path
cited as context, like ci.yml, no longer counts), and check:spec-touches
fails on an unmarked entry that names nothing tracked. Shared wiring
(ci.yml, the package.json files, scripts/tests/, the root CLAUDE.md)
belongs here when the plan changes it; the audit ignores it.
docs/specs/plan-scope-check.spec.md. Required on a new spec, with at
least one unmarked entry, or a `-` entry for a file tracked when the
rule's cutoff was set, outside barwise/docs/specs/: `+` entries alone do
not count, and neither does the spec's own path, so a placeholder cannot
satisfy it (check:spec-touches; docs/specs/touches-required.spec.md). -->

<!-- Plan-reviewed: <commit> (code-review, pr-review)

Add that line to the header above after /code-review and /pr-review have
run on the spec, and before any implementation commit: <commit> is the
head those reviews read (spec-writer, step 8). It is left in this comment
because a template that carried it would ship a spec claiming a review
that never ran. The line vouches for the body, everything below the
header block, as it stood at that commit, so header edits such as Status
do not void it and a rewritten plan does. check:plan-review fails a pull
request that names this spec and changes a Touches: path, while the spec
is new or its Status claims nothing is built, unless the line names a
commit that precedes every such change and whose body matches the plan
as implementation began. -->

## Principle

<The design pillar at stake -- determinism in core, orthogonality and
composability, explicit over implicit, DRY-secondary -- and why this
change serves it. State the problem as a violation of, or gap against,
the principle. Keep it to a short paragraph or two.>

## Should we <the key design question>? (resolved: <yes/no>)

<Optional. Include when the spec turns on a non-obvious design choice
the reader should see reasoned through, not just asserted. Lead with the
resolving observation, then the refinements that keep it honest.>

## Scope

In scope: <the concrete changes this spec covers. State hard
requirements in EARS form -- "When `<trigger>`, the system shall
`<response>`.">

Out of scope: <what is deliberately deferred, and to where -- a later
workstream, a separate finding, a follow-up. Name it so the boundary is
explicit.>

## Inventory

<A table classifying each affected module/area and the verdict. Align
the columns (generate with a script). Example columns:>

| Module          | Current state      | Verdict                |
| --------------- | ------------------ | ---------------------- |
| `path/thing.ts` | <what it does now> | <stays / moves / pure> |

<A sentence on anything that looks affected but is not, and why.>

## Target architecture

```
<A fenced code block sketching the end state -- which package owns what,
what each exposes, and the boundary that is being restored. Concrete
beats prose here.>
```

## Alternatives considered

- **<Rival design>.** <What it would look like and why it lost. Keep
  the discarded frames here -- a reviewer weighing the choice, or a
  later implementer who trips a tripwire, looks in this section first.>

## Workstreams (each independently shippable)

<Ordered smallest-blast-radius first. Each is its own PR and keeps the
full suite green. Note coupling that forces steps together. Mark any
workstream drafted ahead of its grounding "(provisional: not yet
grounded)" until you verify it; drop the marker when you do.>

### 1. <name>

<What changes, why it is first, what it does and does not touch.>

### 2. <name> (provisional: not yet grounded)

<...>

## API and migration impact

- <What moves out of / into which package; which public exports change.>
- <Blast radius: which downstream packages update. The one-way
  dependency graph makes the build surface every site.>
- <Any registration/wiring the tool layer must add.>

## Open decisions (for review)

- **<Decision name>.** <The options and the trade-off. Recommend a
  default. These are the reviewer's call -- do not silently decide.>

## Risks and testing

- <Behavior that must not change; how the existing suite guards it.>
- <Whether to land as separate PRs; what to run after each.>
- <End-to-end guards (e.g. the examples/ validation step).>

## Non-goals

- <What this explicitly does not do -- no new capabilities, interfaces
  unchanged, etc. Prevents scope creep during implementation.>
