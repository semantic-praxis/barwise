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

11. **Benefit-tail participles.** A factual statement with an unearned
    benefit clause welded on: "..., enabling faster iteration,"
    "..., ensuring consistency," "..., making the code more
    maintainable." The claim rides in on grammar instead of argument.
    Flag when the trailing clause asserts a benefit the surrounding
    text does not demonstrate; promote it to a claim with evidence or
    cut it.

12. **Synonym doublets.** Two near-synonyms joined by "and" for
    rhythm: "clear and concise," "robust and reliable," "simple and
    straightforward." One word carries the meaning; the second is
    padding. Flag unless the pair draws a real distinction the
    sentence needs ("build and test" is two things; "clean and
    elegant" is one).

13. **Vague quantifiers.** "Several modules," "various callers," "a
    number of tests," "numerous places." In a spec every one of these
    is checkable -- grep and count. Flag each; replace with the number
    or the list. The accuracy pass catches some of these later, but by
    then a vague count reads as settled prose -- catch it at the word
    level too.

14. **Importance inflation.** "Critical," "key," "essential,"
    "crucial" attached to routine nouns -- "the key insight," "a
    critical component." When everything is key, nothing is. Flag any
    section using more than one; keep the single instance naming a
    genuinely load-bearing element, or better, show the stakes instead
    of asserting them.

15. **Redundant wrap-up.** A closing sentence that restates what the
    section just said: "In summary," "Ultimately, this design,"
    "Taken together." BLUF already put the conclusion first; a
    restated conclusion at the bottom is padding. Flag any final
    restatement that adds no new constraint or number.

16. **Copula avoidance.** "Serves as," "acts as," "functions as,"
    "stands as," "represents" where "is" is meant. Inflates a
    definition into a performance. Flag when substituting "is" loses
    nothing.
