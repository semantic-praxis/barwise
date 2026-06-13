# Sensemaking: Reason the Design Before Writing It

A spec is an argument: this design resolves this problem. The failure
mode, under time pressure especially, is committing to the first
plausible design and writing it up before testing it against the code.
This discipline -- adapted from Gary Klein's data-frame sensemaking --
is what the "Ground it" step invokes. Scale it to the change: a one-file
fix needs a sentence of this; a cross-package refactor needs all of it.

## Evidence and frames

The reasoning alternates between two things:

- **Evidence** -- what the code actually does, how callers use it, what
  the principles and constraints require. Grounded, verified facts.
- **Frame** -- a candidate design: a structural claim about how the
  change should be shaped and why (a story, not a checklist of edits).

## Anchors

Ground the design in three or four explicit anchors -- the verified
facts it rests on. Name them, and say why each earns the place. Early
anchors stick: the first facts you fix shape every frame that follows,
so verify them against the code, not memory. (Workstream 2 was miscoped
from an unverified anchor -- the belief that staleness and impact were
pure, when both read the manifest from disk.)

## Hold two or three frames

Resist the first plausible design. Sketch two or three candidate frames
and keep them open until the evidence chooses. One frame is premature
commitment; five is dilution.

## Expectancies -- the test that catches miscopes

For the leading frame, state what the code or usage should and should
not show if the frame holds, then go check:

> If `checkStaleness` is already pure, it should not call `readManifest`.
> Check: it does. The frame is wrong; reframe.

A frame that makes no checkable prediction cannot be tested, and an
untested frame is how a spec ships the wrong scope.

## Stress test, then commit

Before drafting, hunt for disconfirming evidence -- other callers, edge
cases, blast radius -- and classify each tension:

- **Dismissible** -- explained within the frame.
- **Concerning** -- absorbed with a tweak.
- **Frame-breaking** -- the design has to change.

Commit to the frame with the fewest serious tensions. Carry the
survivors into the spec's Open decisions and Risks; do not bury them.

## Tripwires

Name the signals during implementation that should reopen the design --
the spec's "revise if the scope differs from the brief," made specific:
"if a fourth caller of `readManifest` turns up, the workstream is bigger
than scoped."
