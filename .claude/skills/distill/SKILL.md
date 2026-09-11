---
name: distill
description: Cut verbose LLM-drafted prose down to what it actually claims - specs, PR bodies, design docs, READMEs, review replies, commit messages. Use when a document reads bloated, padded, or over-explained, when asked to shorten, tighten, condense, or trim writing, or before sharing a draft a model wrote. Rebuilds from the document's claims instead of trimming sentences, and reports every claim it dropped.
---

# Distill

Extract what the document claims, throw the prose away, write it again
from the claims. Then say what you dropped.

Do not trim. Trimming anchors on the draft you were handed: you cut
adjectives and hedges inside a skeleton that has four paragraphs where
the content justifies one, and land at 80% of the original, still
bloated and now also choppy. LLM bloat is structural before it is
lexical, so the sentence-level pass cannot reach it. Rebuilding lets
the structure follow the content instead of inheriting the draft's.

Rebuilding is the more dangerous operation -- it can drop substance
along with padding -- which is why the inventory comes first and the
accounting comes last. You cannot check what survived unless you
enumerated it before you started.

## 1. Inventory

Read the source and list every item of four kinds, with its location.
Work at the section level for anything long; a whole document at once
degrades into skimming.

- **Claims.** A claim is a sentence a reader could disagree with and
  be wrong. Falsifiability is the whole test: "the registry resolves
  over `builtinArtifacts` alone" can be false; "this is an important
  consideration" cannot, so it carries nothing and its length is its
  only contribution.
- **Reasons.** Why a rule exists, why an alternative lost, which
  failure a guard prevents. See "What never gets cut" -- this is the
  one most often lost.
- **Instructions.** What the reader must do, in what order.
- **Evidence.** The number, the command that produced it, the
  incident, the file path, the date.

Everything the inventory did not pick up is scaffolding. Scaffolding
earns its place only by making the four kinds findable: a heading a
reader navigates by, a table that beats prose for comparison.

## 2. Classify what is left

Only one of the six fixes is deletion. Naming the kind tells you which
one applies.

| Bloat kind            | Tell                                                       | Fix                                       |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------- |
| Padding               | no truth conditions; deleting it removes nothing checkable | delete                                    |
| Restatement           | a claim already inventoried at another location            | keep one home, cut the rest               |
| Abstraction inflation | forty words of generality wrapped around one instance      | replace with the instance                 |
| Hedge sprawl          | the claim is never actually committed to                   | decide it, or move it to an "open" bucket |
| Structural bloat      | a heading or section filling a template slot               | collapse into its neighbour               |
| False parallelism     | three items where the third restates the first             | merge                                     |

Abstraction inflation is the highest-yield row and the easiest to miss,
because the general statement reads as the more serious writing. It is
usually the instance that was checkable.

## 3. Rebuild

Write the document from the inventory. Treat the original's headings as
evidence of what the author thought mattered, not as a constraint --
if two sections hold one claim between them, they are one section.

Order by what the reader must decide or do first. The repo's house
style is BLUF (`spec-writer`), and a rebuild is the cheapest moment to
apply it, because you are holding the claim list and can see which
claim is the conclusion.

## 4. Sentence pass

Scan the rebuilt text against `.claude/skills/spec-writer/llm-tics.md`,
the catalogue of sentence-level tells, each with a flag condition. Do
not restate its entries here, and do not run this pass first: on the
original it polishes text you are about to throw away.

## 5. Account for the drops

Walk the inventory against the distilled version. Every item is in one
of two states, and there is no third:

- **carried** -- present in the output, possibly reworded;
- **dropped** -- with the reason, reported to the user.

Report the drops in the reply, not in the document. A drop is
legitimate (a restatement consolidated, a claim the document made
twice) or it is a finding the user needs to see. Either way, silence
is the one unacceptable outcome: a distillation that cannot say what
it removed looks identical whether or not it lost the argument.

**Stop when the next cut removes a claim.** That is the rule, not a
word count.

## What never gets cut

- **The reason attached to a rule.** This is the first thing a
  compressor cuts and the last thing that should go. "Never `cd` in a
  command" survives compression fine; without the incident behind it
  -- the harness moves the working directory between commands, and a
  satisfied `cd` at the head of an `&&` chain skipped a gate silently
  -- the next reader deletes the rule the first time it is
  inconvenient. A reason is what lets a rule survive contact with a
  case it does not literally cover.
- **Text that is long because it is exact.** EARS requirements,
  acceptance criteria, enumerated edge cases, error messages, licence
  text, an API's list of what it rejects. Compressing an enumeration
  into "handles the edge cases" is a loss wearing a win's clothes.
- **Numbers, paths, dates, commands, and issue ids -- above all, the
  command that produced a number.** Not because they are cheap per word,
  but because the command is what makes the claim falsifiable later. In
  this repo's own correction record, roughly three quarters of spec
  defects were caught by re-running a claim rather than by reading one,
  and a number whose instrument was cut cannot be re-run
  (`barwise/docs/spec-correction-taxonomy-2026-09-11.md`). Cutting the
  command keeps the claim and destroys the mechanism that would have
  caught it being wrong.
- **Named alternatives and why they lost.** A later implementer who
  trips a tripwire reads that section first.
- **Stated uncertainty.** "We have not decided X" is a claim. Cutting
  it converts an open question into an apparent decision.

## Reading the compression ratio

Look at it; never target it. The ratio correlates with bloat removed
through the mechanism "padding occupies words", and diverges from it
exactly where the compression came from dropping claims -- which makes
it a shadow in the sense CLAUDE.md uses, useful as a diagnostic and
wrong as a gate.

**The band applies only to padded input, and judging that comes first.**
Prose drafted without an editing pass typically lands at 40-60% of its
original length. Prose already written to a style that bans the tics is
claim-dense and should land far higher: measured once, a barwise spec
distilled to 95%, which was the stopping rule working rather than a
failed pass. A dense document that barely moves is a correct result, so
do not treat the band as a target to reach.

Once the input is established as padded:

- **above 80%** -- you may have run a word-level pass on a structural
  problem. Go back to step 3 and check whether you kept the draft's
  skeleton.
- **below 25%** -- open the drop list. Either the document genuinely
  asserted very little, which is a finding, or you cut claims.

## When a section distills to nothing

If a section's inventory is empty, the section asserts nothing. Say so
-- do not paraphrase it into a shorter version of nothing. This is the
most useful thing distillation produces, and it is invisible until the
padding is gone.

The same pass exposes missing reasons. Bloat hides them: a paragraph
that spends sixty words asserting a design is good reads as an
argument until you inventory it and find one claim and no reason. Name
that gap; the fix is for the author to supply the reason, not for you
to invent one.

## Example

Before, 94 words:

> It is worth noting that error handling is a critical aspect of the
> import pipeline. The importer needs to be robust and reliable when
> dealing with malformed input. There are several considerations here.
> First, the parser may encounter input that does not conform to the
> expected schema. Second, network failures could potentially occur
> during the fetch stage. Third, the downstream mapper may reject
> records that the parser accepted. With that in mind, our approach is
> to fail fast and surface errors to the caller, ensuring that problems
> are caught early rather than propagating silently.

Inventory: four claims (three failure points, one policy), no reason,
no evidence. After, 38 words -- 40% of the original, the bottom of the
band above:

> The importer fails fast: an error surfaces to the caller rather than
> being absorbed. Three failure points -- the parser on off-schema
> input, the fetch stage on a network error, and the mapper on a record
> the parser accepted.

Dropped: "robust and reliable" (synonym doublet, no truth conditions),
"caught early rather than propagating silently" (restates fail-fast).
Reported as a finding: the passage never says **why** fail-fast beat
collecting errors and returning them together, and the padding is what
made the absence hard to see.

## Working on a tracked file

Edit it in place and put the account in the reply. Do not leave a
`-distilled.md` copy beside the original; the repo's duplication rule
treats a second copy of a document as a must-agree pair, and this one
would have no owner.

Leave the metadata lines alone -- a spec's `Status`, `Created`,
`Last-updated`, `Tracking`, and frontmatter are a contract with
`npm run audit:specs`, not prose. Update `Last-updated` if the edit is
substantive.

## Related skills

- `articulation` -- whether the idea reaches its audience at all. Its
  wall-of-detail barrier overlaps here, but its remedy is hierarchy
  and this one's is volume. Run it when the distilled version is tight
  and still does not land.
- `spec-writer/editing.md` -- the ordered edit passes for a spec **you
  are drafting**, where you know which claims are load-bearing because
  you made them. Distill is for a draft whose author is not in the
  room.
- `spec-writer/llm-tics.md` -- the sentence-level instrument step 4
  runs on.
