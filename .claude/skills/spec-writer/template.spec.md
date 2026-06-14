# <Title: what this change achieves>

Status: Draft for review (design only -- no implementation in this PR)
Tracking: REPO_REVIEW-2026-06.md finding #<n> (or: feature/issue link)

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

In scope: <the concrete changes this spec covers.>

Out of scope: <what is deliberately deferred, and to where -- a later
workstream, a separate finding, a follow-up. Name it so the boundary is
explicit.>

## Inventory

<A table classifying each affected module/area and the verdict. Align
the columns (generate with a script). Example columns:>

| Module          | Current state         | Verdict                |
| --------------- | --------------------- | ---------------------- |
| `path/thing.ts` | <what it does now>    | <stays / moves / pure> |

<A sentence on anything that looks affected but is not, and why.>

## Target architecture

```
<A fenced code block sketching the end state -- which package owns what,
what each exposes, and the boundary that is being restored. Concrete
beats prose here.>
```

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
