# <The concern, in a few words>

Scope: architecture
Date: <YYYY-MM-DD the decision last changed>
Tracking: <issue ids>, docs/specs/<the spec that holds the reasoning>.spec.md
Enforced-by: npm run check:<gate> (<decision-id>), tests (<decision-id>),
none (<gap issue id>: <decision-id>)

<!--
One ADR per concern, named for it in stable kebab case
(barwise/docs/adr/<concern>.md), and edited in place: the file on main
is the current decision. Scope is `architecture` or `process`. Move
Date only when the decision changes, not for a reflow. The PR that
changes this file says what changed and why. npm run check:architecture
checks the header fields and the Decision section, and that every
reference to this ADR resolves (docs/specs/architecture-index.spec.md).

Enforced-by: is required and comes last in the header. It accounts for
every numbered decision by its {#id}: `npm run <check:* or audit:*>`
for a CI gate that fails when the decision is violated, `tests` for
decisions whose tests carry [adr:<this-file>#<id>] in their titles, and
`none (<issue>: <ids>)` on the decision's own gap issue for whatever no
gate or test holds. Declare a gate only if a violation of that decision
makes it fail (docs/specs/executable-adrs.spec.md).
Delete this comment.
-->

## Context

What forces the decision, in a paragraph or two. The reasoning and the
alternatives belong in the spec named in Tracking; link it rather than
restating it.

## Decision

1. **The rule other work must follow, stated so it can be checked.** {#rule-id}
   Each numbered decision carries a kebab-case id after its bold title.

## Consequences

What follows from the rule, what it costs, and what enforces it. Name
every known place the code breaks the rule, and every gap in what
enforces it, each with its issue id or the reason it is deliberate: an
ADR that states a rule the code does not follow is read as a
description of the system (determinism-in-core found four).
