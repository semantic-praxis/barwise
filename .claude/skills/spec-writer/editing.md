# Editing a Spec

The first draft gets the thinking down; the edit makes it worth the
reviewer's time. Treat them as separate passes: draft fast, then cut.
No first draft is good enough to share.

## The passes

Run these in order over the draft. Each is one focused sweep, not a
re-read.

1. **BLUF.** Move any buried conclusion to the front of its section, so
   the headings, first sentences, and tables carry the decision on their
   own.
2. **Brevity.** Cut every sentence that does not change a decision or an
   action. Throat-clearing intros, restated context, "as noted above,"
   transition filler -- gone.
3. **Redundancy.** Is anything said in more than one place? Consolidate
   to where it belongs. (Common offender: the same rationale repeated
   across Principle, Scope, and a cost paragraph.)
4. **Voice.** Delete weasel words and hedges -- "should probably," "it
   may be worth," "fairly," "somewhat," passive evasions. State claims
   directly. Confine genuine uncertainty to "Open decisions," where it
   is honest. Scan for the tics in `llm-tics.md` during this sweep.
5. **Word level.** Prefer the short word, the active verb, the concrete
   noun. Cut qualifiers. Replace jargon a new contributor would not know.
6. **Accuracy.** Re-verify each surviving claim against the code.
   Cutting for brevity can quietly drop a caveat that was load-bearing.
   Flag confident claims in sections drafted ahead of their grounding --
   counts ("~3 files"), sizes ("near-empty", "thin"), and structural
   assertions -- and either ground them now or mark them provisional
   (see `sensemaking.md`). An ungrounded claim in settled prose is how a
   spec ships the wrong scope.
7. **Pre-push gate.** Clear the gate in `SKILL.md` before pushing.

## What never gets cut

Brevity serves the reviewer; it does not strip the substance they need:

- The principled argument. "No interop format is mandatory to core, so
  core should ship none" is the value, not filler.
- The inventory, target architecture, and workstreams -- what a reviewer
  needs to judge feasibility and an implementer needs to act.
- Concrete file paths, the blast radius, and the open decisions.

## Read it cold

Self-editing is hard because you know what you meant. Before sharing,
read the draft as the reviewer will -- top to bottom, no prior context,
asking at each section: "does this change what I decide or do?" A
section that earns no answer gets cut or folded.
