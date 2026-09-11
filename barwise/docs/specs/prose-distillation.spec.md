# A distill skill: cut LLM-drafted prose to what it actually claims

Status: Implemented (the skill lands alongside this spec)
Created: 2026-09-11
Last-updated: 2026-09-11
Tracking: barwise-1011

## Principle

Orthogonality, in the form the skills-restructure spec gave it: each
instruction gets exactly one home, and every other artifact points at
it. Three artifacts already touch prose quality and none of them does
this job. `articulation` judges whether an idea reaches its audience --
a wall of detail is one of its barriers, but its remedy is
hierarchy, not volume. `spec-writer/editing.md` runs ordered edit passes
over a spec **you are drafting**, where you know which claims are
load-bearing because you made them. `spec-writer/llm-tics.md`
catalogues the tells at the sentence level.

The gap is the common case: a document already exists, a model wrote
most of it, and nobody knows which of its 2,000 words are carrying
weight. The reader of that document is not its author, and neither is
whoever has to cut it. That is a different task from editing your own
draft, with a different failure mode -- cutting substance along with
padding -- and it has no owner.

## Should the skill trim sentences or rebuild from claims? (resolved: rebuild)

Trimming plateaus, because LLM bloat is structural before it is
lexical. A deletion pass anchors on the paragraphs it is given: it
removes adjectives and hedges inside a skeleton that has four
paragraphs where the content justifies one, and lands around a 20%
reduction that leaves the document still bloated and now also choppy.
The tics catalogue is a sentence-level instrument, so running it alone
reproduces exactly this ceiling.

Rebuilding breaks the anchor. Extract every claim the document makes,
discard the prose, write the document from the claim list. The
structure is then derived from the content rather than inherited from
the draft, which is what produces the 2-3x reductions the task is
asking for.

Rebuilding is also the more dangerous operation, which settles the
rest of the design: it needs a safety net that trimming does not.
The inventory is that net. Because the claims were enumerated before
the rewrite, the distilled version can be checked against the list,
and every claim is either present or dropped with a stated reason.
That is the gate-refusal contract applied to prose -- an instrument
that reports what it did not carry across, rather than one that looks
the same whether or not anything was lost.

## What counts as a claim (resolved: a sentence that could be false)

The method needs a test for "load-bearing" that does not rest on
taste, because taste is what fails on someone else's draft. The test
is falsifiability: a claim is a sentence a reader could disagree with
and be wrong. "The registry resolves over `builtinArtifacts` alone"
can be false. "This is an important consideration" cannot -- it has no
truth conditions, so it carries nothing, and its length is the only
thing it contributes.

Three kinds of non-claim survive anyway, and the skill names them so
they are not cut by a literal reading of the test: the **reason**
attached to a rule, the **instruction** telling a reader what to do,
and the **evidence** behind a number. The reason is the one worth a
rule of its own. It looks like padding and is the most load-bearing
content in this repository's style: "never `cd` in a command" survives
compression, but without the incident that produced it, a later reader
deletes the rule the next time it is inconvenient.

## Scope

In scope: a `.claude/skills/distill/SKILL.md` carrying the inventory
method, a classification of bloat kinds by their distinct fixes, the
drop-accounting step, and the rules on what never gets cut. It applies
to any prose artifact -- specs, PR bodies, design docs, READMEs,
review comments, CLAUDE.md sections.

When a source file is tracked in the repository, the skill shall edit
it in place and report the account of dropped claims in the reply,
rather than leaving a second copy beside it.

When the claim inventory for a section is empty, the skill shall
report that the section asserts nothing rather than paraphrasing it
into a shorter version of nothing.

Out of scope: verifying that the surviving claims are _true_ (the
accuracy pass in `editing.md` owns that, against the code); judging
whether the document reaches its audience at all (`articulation`
critique mode); and writing a new document (`spec-writer`).

## Inventory

| Artifact                  | Current role                        | Verdict                         |
| ------------------------- | ----------------------------------- | ------------------------------- |
| `articulation/SKILL.md`   | does the idea land for the audience | unchanged; distill points at it |
| `spec-writer/editing.md`  | six passes over your own spec draft | unchanged; distill points at it |
| `spec-writer/llm-tics.md` | the sentence-level tell catalogue   | unchanged; distill points at it |
| `.claude/skills/distill/` | (new)                               | owns the rebuild method         |

`distill` restates none of the tics. It names the file as the
instrument for its sentence-level pass, the way `pr-creation` names
`pr-review/checklist.md` as its output specification without copying a
line of it (`docs/specs/pr-skills.spec.md`).

## Method

```
1. Inventory      every claim, reason, instruction, and piece of
                  evidence, with its location. Falsifiability is the
                  test for a claim.
2. Classify       what the inventory did not pick up, by bloat kind --
                  each kind has a different fix, and only one of the
                  six is "delete".
3. Rebuild        the document from the inventory. Structure follows
                  content; the draft's headings are evidence, not a
                  constraint.
4. Sentence pass  scan the rebuilt text against llm-tics.md. Last,
                  not first: on the original it polishes text that is
                  about to be thrown away.
5. Account        every inventoried claim is present or dropped with a
                  reason, and the drops are reported.
```

The stopping rule is step 5, not a word count: stop when the next cut
removes a claim.

## Alternatives considered

- **Extend `spec-writer/editing.md`.** Cheapest, and wrong on two
  counts: it would scope a general capability to specs, and
  `editing.md` is reachable only by loading `spec-writer`, which is a
  skill about _writing_ a spec. Someone holding a bloated README
  would never find it.

- **A tics-driven pass with no inventory.** This is what a session
  does today without the skill, and it is the 20% ceiling above. It
  also has no safety net: nothing distinguishes a cut paragraph of
  padding from a cut paragraph of argument.

- **Move `llm-tics.md` into `distill/`.** Defensible -- the catalogue
  is general prose guidance sitting in a spec-scoped directory, and
  distill is its heavier consumer. Deferred to Open decisions rather
  than taken silently, because it edits a working skill to no
  functional gain.

- **A word-count or ratio target.** Rejected on the shadow rule
  (CLAUDE.md): compression ratio correlates with bloat removed through
  the mechanism "padding occupies words", and diverges exactly where
  the compression came from dropping claims instead. The skill reads
  the ratio as a diagnostic and refuses to gate on it.

## Open decisions (for review)

- **Where `llm-tics.md` lives.** Options: leave it in `spec-writer/`
  and have `distill` point across (recommended -- no working skill is
  edited, and the cross-skill pointer follows the `pr-creation` /
  `pr-review` precedent), or move it to `distill/` and update the
  three references in `spec-writer/SKILL.md` and `editing.md`. The
  second is tidier by name and costs a two-file edit; take it if the
  catalogue grows past prose tics.

- **Whether `distill` gets an `evals/evals.json`.** `pr-creation` and
  `pr-review` have one; the rest of the skills do not. Distillation is
  gradeable (a fixture document with a known claim set, asserting no
  claim was dropped), so the case is stronger here than for most.
  Recommended as a follow-up rather than in this change, so the method
  is exercised on real documents before a fixture pins it.

## Risks and testing

- **The skill cuts substance.** This is the failure the whole design
  is arranged against, and step 5 is the guard: drops are enumerated
  and reported, so a wrong cut is visible in the reply rather than
  discovered later by the document's next reader.
- **Precise text read as verbose text.** EARS requirements,
  acceptance criteria, and enumerated edge cases are long because
  they are exact; "handles the edge cases" is a loss wearing a win's
  clothes. Called out in the skill as a class to leave alone.
- No code changes, so no package tests apply. `npm run fmt` covers
  the two new markdown files, and `npm run check:book-citations`
  already reads `.claude/skills/**/*.md`.

## Non-goals

- No new CLI, MCP, or VS Code surface -- the capability matrix is
  untouched.
- No change to `articulation`, `spec-writer`, or `llm-tics.md`.
- No automated gate on prose length. Reading the ratio is the
  reader's job; ratcheting on it is what turns a shadow into
  Goodhart's law.
