---
name: articulation
description: A meta-skill for making any artifact communicate clearly — prose, code, diagrams, data models, commit messages, or documentation — and for driving clarity out of vague requests. Use this whenever creating a written or code artifact for an audience; whenever asked to review, critique, or improve the clarity of an existing artifact; and whenever gathering, refining, or pinning down requirements from a stakeholder request that is vague, ambiguous, or underspecified. Trigger on phrases like "articulation review," "is this clear," "tighten this up," "why is this confusing," "review this for clarity," "help me figure out what they actually want," "turn this ask into requirements," or when a user shares a fuzzy stakeholder request. Also apply it silently as a quality lens during creation of documents, designs, and code. This skill is a peer to any formatting or conventions skill — conventions govern structure and style; articulation governs whether the artifact actually lands with its audience.
---

# Articulation

Articulation is the act of moving an idea from one mind to another with minimal loss. Every artifact — a design doc, a function, a conceptual model, a commit message — is an attempt at this transfer. The artifact succeeds when the audience can do what they need to do after encountering it, and fails when a barrier stops them, even if every individual sentence or line is technically correct.

This skill operates in three modes:

- **Creation mode**: apply the principles below as a lens while producing an artifact.
- **Critique mode**: run the diagnostic procedure against an existing artifact and produce an articulation review.
- **Elicitation mode**: apply the principles interrogatively, to help a stakeholder articulate what they actually need — turning a vague request into precise requirements.

All modes rest on the same foundation. Read the principles first; the modes tell you how to apply them.

## Foundation: the audience contract

Before writing or reviewing anything, answer two questions:

1. **Who is the audience?** Be specific. "Engineers" is fuzzy; "a data engineer fluent in SQL and ER diagrams but new to fact-based modeling" is usable. If the artifact serves multiple audiences, name the primary one — an artifact optimized for everyone is optimized for no one.
2. **What must they be able to do afterward?** Understanding is not the goal; action is. After reading a design doc, a reviewer must be able to approve or object. After reading a function signature, a caller must be able to call it correctly without reading the body. After reading a commit message, a future debugger must be able to decide whether this commit is relevant to their bug.

Everything else in this skill is in service of that contract. A "clear" sentence that doesn't advance the audience toward their action is decoration.

## The verbalization test

The single most reliable articulation check: **state the idea as one plain sentence, out loud or in writing, before committing to the artifact form.**

- For a document: "This doc argues that Payment should be its own entity type, not an attribute of Order, because a payment accrues its own facts — method, refunds, timestamps." If you cannot produce this sentence, the document is not ready to be structured — the thinking is unfinished.
- For a function or module: "This function returns the latest valid price for an asset, or raises if none exists." If the sentence requires "and" to be truthful ("...and also updates the cache and logs a metric"), the unit is doing too much, and no amount of naming will make it articulate.
- For a data model or schema: verbalize the facts it records as natural-language sentences ("Each Auction is conducted at exactly one Site"). If a fact cannot be verbalized cleanly, the model is encoding something nobody can state — a defect that will surface later as confusion.

Failure to pass the verbalization test is diagnostic, not cosmetic. It means the problem is upstream, in the thinking. Fix the idea, then return to the wording.

## Barrier taxonomy

A barrier is anything that stops the audience or forces them to do the author's work. Hunt for these specifically — "be clearer" is not actionable, but "you buried the lede" is. The six that account for most failures:

1. **Buried lede.** The point the audience needs first appears late, after context they cannot yet use. Symptom: the reader must finish the artifact before knowing why they are reading it. Fix: state the conclusion or purpose first, then support it. (In code: the public interface should communicate purpose before implementation detail does.)

2. **Undefined term.** A word the audience cannot resolve: unexplained jargon, an acronym used before expansion, a project codename with no referent. The author's familiarity is invisible to the reader. Fix: define at first use, or replace with a plain word. Note the inverse trap: defining terms the audience already knows, which is condescension and noise.

3. **Ambiguous reference.** A word that could mean two things in context: "it," "this," "the service," "the old approach." Each ambiguity forces the reader to guess, and some will guess wrong silently. Fix: repeat the noun. Repetition is cheaper than ambiguity. (In code: a variable named `data` or `result`, a parameter named `flag`, a function named `process` — names that could bind to anything.)

4. **Missing bridge.** A logical leap the author made internally but never wrote down. The conclusion follows from the premises only if the reader supplies an unstated step — and the reader may not have it. Fix: write the step. If writing it feels tedious because it is "obvious," check whether it is obvious to the named audience, not to the author.

5. **Wall of detail.** Everything the author knows, presented at uniform depth, with no signal about what matters. Detail is not generosity; undifferentiated detail transfers the work of prioritization to the reader. Fix: ruthless hierarchy — the main line of argument in the body, supporting detail pushed to appendices, footnotes, linked references, or deleted. (In code: a shallow module — an interface as complex as the implementation it wraps — is a wall of detail. A deep module hides detail behind a simple interface, which is articulation applied to design.)

6. **Fuzzy abstraction.** A word that sounds like a claim but cannot be operationalized: "flexible," "clean," "properly normalized," "captures the domain." Test: could two reasonable readers disagree about whether the claim is true? If yes, it is fuzz. Fix: replace with the concrete fact that motivated the word ("a new payment method can be added without changing the Order schema" instead of "flexible"). Fuzzy abstractions in an artifact are the strongest available signal of fuzzy thinking behind it.

## Applying to code specifically

Code is read far more often than written; every reading is an act of the code articulating itself to a person. The barriers above translate directly, plus:

- **Names are the interface to thought.** A name is a one-word verbalization. Prefer names that state what a thing is or does in the domain's language (`unreconciled_invoices`, `bid_increment`), not its mechanics (`temp_df2`, `helper`). If naming something is hard, that difficulty is the verbalization test failing — reconsider the boundary, not just the name.
- **Interfaces should be simpler than implementations.** A caller should learn less to use a module than the author learned to write it. If using a function correctly requires knowing its internals, the module is not articulating; it is leaking.
- **Cohesion is felt as intuition.** When a module is cohesive, its parts interact in ways a reader can predict before looking — the second function is where you expect, doing what its name says. That intuitive feel is the audience-facing evidence of a well-articulated boundary. When a reader keeps being surprised, the boundary is wrong: move the surprising element to where the reader expected it, or rename the module to state what it actually contains.
- **Commit messages and PR descriptions are prose artifacts.** Apply the full taxonomy: lede first (what changed and why), no ambiguous references ("fixed the bug" — which?), no missing bridges (why this approach over the obvious one).

## Creation mode

While producing any artifact:

1. Establish the audience contract before drafting. If the request does not specify audience or intended action, decide by impact: ask when the answer would materially change the artifact (a proposal to a CFO and to a tech lead are different documents); otherwise state your assumption explicitly at the top of the work so it can be corrected.
2. Pass the verbalization test before structuring. Write the one-sentence version first, and let it become the lede.
3. Draft, then sweep once specifically for the six barriers. This is a distinct pass — do not trust the drafting pass to have avoided them, because barriers are invisible to the person who knows what they meant.
4. Prefer deleting to hedging. When a sentence or code path survives only because removing it feels risky, that is usually a missing verbalization — either articulate why it must stay, or cut it.

Creation mode is silent. Do not narrate the checklist to the user or label the output with articulation terminology; just produce work that passes.

## Critique mode

When asked to review an artifact for clarity, produce an **articulation review** with this structure:

```
# Articulation Review: [artifact name]

## Audience contract
[The audience and intended action the artifact appears to assume.
If it assumes none, say so — that is finding #1.]

## Verbalization
[The one-sentence version of what this artifact is trying to say,
as best it can be reconstructed. If it cannot be reconstructed,
state that the core idea is not yet articulated and stop the
review here — barrier-level fixes cannot rescue an unformed idea.]

## Barriers
[Each barrier found, ordered by severity — how much it impedes
the audience's intended action:
- **Type** (from the taxonomy) — location — why it stops this
  audience — a concrete suggested fix, with rewritten text or
  renamed identifier where practical.]

## Verdict
[One of: (a) wording problems — the thinking is sound, apply the
fixes; (b) thinking problems — specific ideas are not yet formed,
and which ones; (c) sound — the artifact articulates, with at most
minor fixes.]
```

Keep the review honest about the wording/thinking distinction. Telling an author to polish sentences when the underlying idea is unformed wastes their time and hides the real problem. The most valuable output of a critique is often the sentence "you have not yet decided X," delivered plainly.

## Elicitation mode

Requirements gathering is articulation in reverse: the idea lives in the stakeholder's head, often unformed, and the job is to help them get it out with minimal loss. The barriers stop being findings and become probes — each barrier type has a corresponding question that converts fuzz into fact.

When given a vague request ("we need a Customer type," "make the returns model cleaner," "add better handling of optional data"):

1. **Open with a critical incident.** Before any other probe, ask for a specific recent story: "Walk me through the last time this failed you — what were you trying to do, what happened, what did you do instead?" For greenfield requests with no failure history, use the forward variant: "Walk me through how you would use this next Tuesday, step by step." One concrete story usually recovers the real need faster than any general question, and its answer determines which probes below matter at all.

2. **Reconstruct the audience contract.** Who experiences the problem, and what are they unable to do today? Many requests arrive as proposed solutions; the contract question recovers the underlying need. "We need a Customer type" often decompresses to "sales tracks leads and billing tracks payers, and forcing both to be one Customer makes every shared report ambiguous."

3. **Probe by barrier type.** Match the fuzz to its probe:
   - *Buried lede* (long background, no ask) → ask for the lede: "If you had one sentence to tell me what you need, what is it?"
   - *Fuzzy abstraction* ("fast," "robust," "seamless") → ask for the observable: "What would a user see or measure if this were true? What do they see today instead?"
   - *Ambiguous reference* ("the report," "the old system") → ask for the referent: "Which report specifically? Can you show me one?"
   - *Missing bridge* ("we need X so that Y") → ask for the mechanism: "Walk me through how X produces Y — what happens in between?"
   - *Wall of detail* (a request that lists twelve things) → ask for the hierarchy: "If we could ship only one of these this quarter, which one, and why that one?"
   - *Undefined term* (stakeholder jargon) → ask for the definition in examples: "Give me a concrete case of a 'qualified lead' and a case that looks similar but isn't one."

4. **Verbalize back, in facts.** After probing, restate the requirement as plain, singular sentences the stakeholder can affirm or correct: "Each Order is placed by exactly one Customer." Concrete examples beat abstractions here — verbalizing specific instances ("this auction, this bidder, this timestamp") and generalizing from them surfaces hidden rules that direct questions about the general case miss. The stakeholder saying "no, that's not quite it" is a success: it means the loss in transfer was caught now instead of after delivery.

5. **Name what is undecided.** Some fuzz is not miscommunication — it is a decision the stakeholder has not made. Do not paper over it with a plausible assumption. Surface it explicitly: "This depends on whether refunds count as revenue, and that is a business decision, not a technical one. Who decides?" A requirements document that honestly lists its open decisions articulates better than one that hides them under confident wording.

Elicitation mode is conversational: ask a small number of high-leverage questions rather than delivering the full battery at once, and let the answers steer which probe comes next.

## Relationship to conventions skills

Formatting and conventions skills (structure templates, BLUF, diagram standards, frontmatter rules) are peers, not competitors. Conventions make artifacts consistent; articulation makes them land. Apply both when both are loaded: follow the conventions for form, and use this skill to judge whether the content inside that form actually transfers the idea. When they appear to conflict — a template section that would force a wall of detail, say — the audience contract wins: adapt the form and note the deviation.
