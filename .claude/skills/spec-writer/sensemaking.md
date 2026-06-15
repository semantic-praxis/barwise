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

Record the anchors you considered and set aside, too -- the facts that
looked load-bearing but did not make the final three or four. A frame
rarely breaks at random: it breaks because one anchor is invalidated,
and the fastest way to reframe is to name the dead anchor, drop it, and
rebuild from the ones held in reserve rather than from a cold start. An
anchor spent on one frame resists reuse in another, so writing the
discards down is what keeps them available when an expectancy fails.

## Hold two or three frames

Sketch two or three candidate designs -- one frame is premature
commitment, five is dilution -- but do not mistake this for keeping an
open mind. The expert move is not suspended judgment; it is committing
to a leading frame fast, with sharp expectancies (below), while holding
the alternatives as live competitors -- including ones you do not yet
believe -- ready to switch to the moment an expectancy is violated.
Evidence gathered without a committed frame is unguided: the frame is
what tells you which code is worth reading in the first place.

## Expectancies -- the test that catches miscopes

For the leading frame, state what the code or usage should and should
not show if the frame holds, then go check:

> If `checkStaleness` is already pure, it should not call `readManifest`.
> Check: it does. The frame is wrong; reframe.

A frame that makes no checkable prediction cannot be tested, and an
untested frame is how a spec ships the wrong scope.

## Stress test, then commit

Before drafting, hunt for disconfirming evidence -- other callers, edge
cases, blast radius. Disconfirmation is the unnatural direction; the
brain reasons better from positive evidence, so the practical move is to
elaborate the strongest competing frame and seek evidence _for it_,
rather than evidence against the leading one. Classify each tension:

- **Dismissible** -- explained within the frame. This is the danger
  bucket: explaining-away is how fixation hides, so a dismissal has to
  be grounded against the code, not narrated.
- **Concerning** -- absorbed with a tweak.
- **Frame-breaking** -- an anchor is invalidated; the design has to
  change.

Commit to the frame with the fewest serious tensions. Carry the
survivors into the spec's Open decisions and Risks; do not bury them.

## Premortem -- fail it on paper first

With a frame committed, run Klein's premortem before drafting: assume
the design shipped and caused a problem, then say what the problem was.
Imagining the failure as already real surfaces causes that "what could
go wrong?" does not -- so reach for concrete stories (a caller broke,
the migration stranded data, the abstraction leaked under the second
use) rather than generic risk. Each cause it turns up has a home: a
likely one becomes a Tripwire, an unresolved one an Open decision, a
fatal one sends you back to reframe.

## Forward sections are provisional until grounded

A multi-workstream spec is usually drafted in one pass, but each
workstream is grounded just-in-time, before its own implementation. So
the later sections state conclusions the evidence has not yet chosen --
and confident prose makes them read as settled fact. Mark them: a claim
drafted ahead of its grounding carries a "(provisional: not yet
grounded)" note on the section or the claim, dropped only once the
workstream is grounded and the claim verified or corrected.

The cost of skipping this is a false anchor that survives every later
read. (Workstream 5 was drafted as "a near-empty package of ~3 thin
shells plus two importers"; grounding it before implementation found
~11 files, and the confident undercount had read as fact across several
revisions.)

## Tripwires

Name the signals during implementation that should reopen the design --
the spec's "revise if the scope differs from the brief," made specific:
"if a fourth caller of `readManifest` turns up, the workstream is bigger
than scoped."
