# <The concern, in a few words>

Scope: architecture
Date: <YYYY-MM-DD the decision last changed>
Tracking: <issue ids>, docs/specs/<the spec that holds the reasoning>.spec.md

<!--
One ADR per concern, named for it in stable kebab case
(barwise/docs/adr/<concern>.md), and edited in place: the file on main
is the current decision. Scope is `architecture` or `process`. Move
Date only when the decision changes, not for a reflow. The PR that
changes this file says what changed and why. npm run check:architecture
checks the header fields and the Decision section, and that every
reference to this ADR resolves (docs/specs/architecture-index.spec.md).
Delete this comment.
-->

## Context

What forces the decision, in a paragraph or two. The reasoning and the
alternatives belong in the spec named in Tracking; link it rather than
restating it.

## Decision

The rule other work must follow, stated so it can be checked.

## Consequences

What follows from the rule, what it costs, and what enforces it. Name
every known place the code breaks the rule, and every gap in what
enforces it, each with its issue id or the reason it is deliberate: an
ADR that states a rule the code does not follow is read as a
description of the system (determinism-in-core found four).
