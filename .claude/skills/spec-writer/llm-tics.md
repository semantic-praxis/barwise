# LLM Tics to Scan For

Spec prose should read like an engineer who checked the code, not a
model filling space. During the voice pass of an edit, scan for these.
Each entry names the pattern and says when to flag it.

1. **The "not X, but Y" construction.** Variants: "It is not X. It is
   Y," "Not X, but Y," "This is not about X; it is about Y." Manufactures
   precision by defining a thing against its opposite, sounding
   argumentative without committing to a claim. Flag unless it corrects
   a misconception the reader is likely to hold.

2. **The rule of three (tricolon).** Three parallel items used for
   rhythm rather than because there are three things to say; the third
   is often a near-synonym of the first two. Flag when the third item
   carries no new information.

3. **Self-announcing sentences.** "It is worth noting that," "The key
   insight here is," "This is important because," "Let's explore,"
   "Let's break this down." They tell the reader something matters
   instead of saying the thing that matters. Flag all of them.

4. **Em-dash overuse.** An em-dash where a period, comma, or colon would
   do the same work with less flair. Flag any section with more than two
   em-dashes; for each, name the simpler punctuation that fits. (House
   style writes the em-dash as `--`, so judge by function vs. flair, not
   the raw count of marks.)

5. **Abstract personification.** "This approach enables teams to," "The
   framework provides," "The architecture ensures." Abstractions do not
   enable, provide, or ensure; people and code do. Flag agency given to
   an abstraction, and rewrite with a concrete actor.

6. **Hedge stacking.** "It might be worth considering whether," "could
   potentially help to." One hedge per sentence is sometimes warranted;
   two or more drain it of meaning. Flag any sentence with more than one
   hedge word (might, could, potentially, possibly, perhaps, generally,
   tends to, in some cases).

7. **Performative transitions.** "With that in mind," "Building on
   this," "Taking a step back," "That said," "Having established X, we
   can now turn to Y." They simulate logical flow without connecting
   ideas. If the next paragraph follows, the connection shows in the
   content; cut the announcement.

8. **Cadence-driven short sentences.** A very short sentence for
   rhetorical punch after a longer one: "And that matters." "This is the
   core problem." "Full stop." Lands once; a verbal tic by the third.
   Flag any document with more than two.

9. **Paragraph-opener monotony.** Three or more consecutive paragraphs
   opening the same way -- a run of "The...," "This...," or gerund
   phrases. Varied openers are basic prose discipline. Flag the run.

10. **Colon-into-list as default structure.** "There are three
    considerations: first... second... third..." where prose would
    communicate the same information more naturally. Flag when the list
    adds no scannability that prose lacks.
