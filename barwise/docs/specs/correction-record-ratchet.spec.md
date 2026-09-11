# Ratchet the correction record: a new spec correction must say what caught it

Status: Implemented (the gate, the baseline and its tests land alongside this spec)
Created: 2026-09-11
Last-updated: 2026-09-11
Tracking: barwise-1013. Seed data and method:
`docs/spec-correction-taxonomy-2026-09-11.md`.

In one sentence: 28 specs already record what their drafts got wrong and
what caught it, nothing reads that back, and a hand pass over it goes
stale the same way every hand pass in this repository has.

## Principle

**A finding is not closed by a document**, which is CLAUDE.md's rule and
also this spec's own subject. The 2026-09-11 taxonomy read 52 correction
records across 28 specs and found that roughly three quarters of spec
defects were caught by executing something and that verbosity caused
none of them. That is a useful result and it is already decaying: the
next spec that records a correction is outside it, and nothing notices.

The same rule the must-agree copies follow -- share it, derive it,
register it, or drift-test it, in the same commit -- applies here.
`audit:duplication` and `audit:rubric` are the shape: a deterministic
detector surfaces candidates, a baseline carries a verdict for each, and
`--check` fails BOTH on a new unclassified candidate and on a stale
entry, so the baseline always enumerates exactly what is open.

## What the gate is for (resolved: keep the classification current, not police the prose)

It does not judge whether a correction should have happened, and it
cannot: a correction is a historical fact about a draft that is already
gone. What it enforces is that **a newly recorded correction says what
caught it**, at the moment the author still knows.

That is the loop the taxonomy left open. A spec records its own defect,
the author moves on, and the aggregate question -- would a document
practice have caught this, or only running it? -- is answered once by
hand and never again. Forcing the classification at record time costs
one baseline row and keeps the only dataset in this repository that
measures outcomes rather than form.

## Should the detector be a marker regex or a declared syntax? (resolved: regex, with false positives classified)

A declared syntax (`<!-- correction: ... -->`) would be explicit over
implicit and would catch exactly what authors remember to mark, which is
the failure mode: the records this corpus already holds were written as
ordinary prose by authors not writing for a detector, and a syntax
introduced now reads none of them.

So the detector is a marker regex over spec paragraphs, and it is
deliberately over-inclusive. A paragraph it surfaces that is not a
correction gets a baseline row with verdict `not-a-correction` and the
reason. That is not a workaround -- it is the same move
`audit-baseline.json` makes for deliberately parallel code, and it makes
the hand filtering that produced the taxonomy's 34-from-52 an auditable
record instead of a judgement call that happened once in a session.

**The marker list lives in the script and nowhere else.** Restating it
here would be a must-agree copy inside the spec for the gate that exists
because unchecked copies drift. `scripts/audit-corrections.mjs` is the
authority; this paragraph is the pointer.

## What "stale" means here, and why it differs from the other two ratchets

For `audit:duplication` a stale entry means the duplication was removed;
for `audit:rubric`, that the check now discriminates. Both are findings
that get fixed. **A correction record is not a finding and never gets
fixed** -- it is a fact about a draft that no longer exists.

Stale therefore means the record is no longer detected in the specs:
its spec was deleted, or the paragraph was rewritten past recognition.
That is still worth failing on, because a baseline row describing text
that is no longer there is a claim about the corpus that nobody can
check -- the shape this repository keeps finding.

## Record identity (resolved: hash the normalised paragraph, not the raw bytes)

An id must survive reformatting and change when the content does.
`dprint` owns `docs/specs/*.md`, so hashing raw paragraph bytes would
re-key every row the first time a paragraph reflowed, and the gate would
report the whole baseline stale and the whole corpus new in one commit.

The id is `<spec-basename>::<first 12 of sha256>` over the paragraph
with whitespace collapsed, markdown emphasis stripped, and case folded.
Reflow does not move it; a changed word does, which is correct -- an
edited correction record is a different claim and should come back
through classification.

## Scope

In scope, stated as requirements:

- When `audit:corrections` runs, the system shall read every
  `docs/specs/*.spec.md` tracked in the repository and report each
  paragraph matching a correction marker.
- When `audit:corrections --check` runs and a detected record has no
  baseline entry, the system shall fail naming the record and its spec.
- When `audit:corrections --check` runs and a baseline entry is no
  longer detected, the system shall fail naming the entry.
- When a baseline entry's `caught_by` is not one of the classification
  values, the system shall fail naming the entry and the permitted
  values.
- When the repository root or the tracked-file listing cannot be
  resolved, the system shall exit `2` and shall not print a pass
  (`docs/specs/gate-refusal-contract.spec.md`).
- When run from the repo root, from `barwise/`, or from a package
  directory, the system shall report the same records.

Out of scope:

- Judging whether a correction was avoidable. The classification says
  what caught the defect, not what should have.
- Reading git history for pre-correction drafts. The taxonomy noted
  those are recoverable and that replaying them is a real evaluation;
  it is a different instrument and a different spec.
- Any change to how specs are written. No new required section, no
  template edit.

## Inventory

| File                                          | Current state                                          | Verdict                                  |
| --------------------------------------------- | ------------------------------------------------------ | ---------------------------------------- |
| `scripts/audit-corrections.mjs`               | did not exist                                          | new: the detector and ratchet            |
| `correction-baseline.json`                    | did not exist                                          | new: one row per record                  |
| `scripts/lib/tracked.mjs`                     | exports `REPO_ROOT`, `trackedFiles()`, both guarded    | imported, not re-derived                 |
| `scripts/tests/gates.test.mjs`                | covers the other gates                                 | gains this gate's tests                  |
| `package.json`                                | has `audit:duplication`, `audit:rubric`, `audit:specs` | gains `audit:corrections`                |
| `.github/workflows/ci.yml`                    | runs the other audits                                  | gains this one, no docs-only skip        |
| `docs/spec-correction-taxonomy-2026-09-11.md` | the hand pass                                          | untouched; becomes the seed's provenance |

No docs-only skip, for the reason `check:book-citations` has none: a
spec edit IS the change this gate checks.

## Alternatives considered

- **A required "what caught it" section in the spec template.** Catches
  nothing retroactively, and a template section is a rule in prose --
  precisely what the taxonomy found does not prevent the defect it warns
  about. The four "a check that cannot fail" corrections happened
  against exactly such a rule.
- **Classify automatically by keyword.** The taxonomy explicitly refused
  this: keyword-matching the catch mechanism is the shadow, and the
  distinction between "grounding by reading code" and "reasoning" is
  the part a keyword cannot see. A human verdict per row is the point.
- **Store the taxonomy's aggregate counts and assert them.** Pins a
  number that must change every time a spec records a correction, so it
  would be edited to whatever the run printed -- a gate that cannot fail
  for the right reason.

## Workstreams

Landed as one change; it is a single gate and its baseline, and a
baseline without the gate that generates it is not shippable.

## Risks and testing

- **The gate must be verified red, not reasoned green** (assertion-audit
  rule 0). Four tests establish the failing reading first: a planted new
  record fails, a planted stale entry fails, an unknown `caught_by`
  fails, and a broken `git` refuses with exit `2` rather than the code
  it uses for a finding.
- **The cwd-invariance test must actually vary cwd**, using the
  `CWDS` idiom already in `gates.test.mjs`.
- **The marker list is the corpus definition.** Widening it surfaces new
  candidates and fails `--check` until they are classified, which is the
  intended behaviour and should not be worked around by narrowing the
  markers back.

## Non-goals

- No new capability on any surface; the capability matrix is untouched.
- No change to what any other gate checks.
- No automatic classification, now or later.
