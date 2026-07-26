---
name: gym-coach
description: Use when a learner asks "what do I keep getting wrong?", "how do I get better at ORM modeling?", or wants a study plan from their modeling-gym history - reads the deterministic session records the barwise gym CLI writes ($XDG_STATE_HOME/barwise/) and coaches from them, mapping recurring failures to the reductive-bias catalog and recommending next exercises, readings, and the proficiency transition to work at.
---

# Coaching a Learner from Their Gym Record

The modeling gym is deterministic: `barwise gym check` grades a
candidate model, emits miss cards for failures, and appends a session
log. This skill is the coaching layer on top -- it consumes those
records and answers "what do I keep getting wrong?" and "how do I get
better at this?". Nothing in the loop depends on it; the records exist
whether or not coaching ever runs (learning-design spec, workstream 6).

## Where the record lives

`$XDG_STATE_HOME/barwise/` (fallback `~/.local/state/barwise/`):

- `gym-sessions.log` -- one tab-separated line per check run:
  `ISO timestamp, exercise id, passed|failed, failed check kinds
  (comma-joined, "-" if none), miss-card file path ("-" if none)`.
- `misses/gym-<exercise-id>.txt` -- the latest miss-card file per
  exercise, in the Anki tab-separated import format (front `\t` back).

Read both before saying anything. If the directory or log is missing,
the learner has not run `barwise gym check` yet -- point them at
`barwise gym list` and `barwise gym show <id>`, and stop.

## How to coach

1. **Establish the trend, not the last run.** Parse the log
   chronologically. Distinguish one-off failures (appeared once, then
   passed) from recurring ones (the same exercise + check kind failing
   across runs). Recurrence is the signal; a failure that was fixed on
   the next attempt is learning working as intended -- say so.

2. **Map recurring failures to the bias catalog.** The reductive-bias
   catalog in `barwise/docs/specs/learning-design.spec.md` pairs each
   failure signature with the habit of thought that produces it:

   | Recurring failure signature | Likely reductive reading |
   | --- | --- |
   | `requires_verbalization` on elementary facts | Table-thinking: lumping elementary facts into one wide fact type |
   | `requires_element` (a missing fact type between two types) | Attribute-first thinking from ER / dimensional modeling |
   | `forbids_population` on a ternary decomposed as binaries | Assuming binary arity; missing a genuine ternary |
   | `must_validate` on missing reference schemes | Conflating entity types with value types |
   | `forbids_population` wholesale (unconstrained model) | Treating constraints as decoration added after |
   | `requires_element` (no subtype-only fact) | Reading subtypes as an ISA taxonomy, not role-derived |

   Name the bias plainly and explain why that reading produced exactly
   this failure. The miss-card backs carry the authored `diagnosis` and
   `reading` for each failure -- quote them rather than inventing new
   explanations.

3. **Recommend the next step at the right grain.**
   - **Readings**: the check-level `reading` references from the miss
     cards, most-recurrent gap first. Reading follows failure; never
     assign reading as a prerequisite.
   - **Exercises**: from `barwise gym list`, pick exercises whose
     transition starts at the learner's current level and that target
     the diagnosed bias -- generation, not re-reading, is what moves a
     learner along the scale.
   - **The transition to work at**: infer the learner's level from what
     they pass unaided (the proficiency scale is in the learning-design
     spec: naive, novice, initiate, apprentice, journeyman, expert).
     Passing an exercise's rubric on the first run means working at or
     below their level; recommend the next transition up.
   - **The deck**: remind them to import the emitted miss-card files
     into Anki (`ORM 2::Misses`) if they have not -- the loop only
     closes if the failures get scheduled. Duplicated cards on
     re-import are intentional (recency), and the misses subdeck is
     disposable.

4. **Keep the diagnosis honest.** The pass/fail record is the
   evaluator's, not your opinion -- coach from what the log shows, and
   when the record is too thin to diagnose a pattern (fewer than three
   runs, or no recurrence), say that and recommend more reps instead of
   speculating.

## Boundaries

- Never edit the session log or miss-card files; they are the gym's
  output artifacts.
- Do not drive the other artifacts (deck, tutorial) from here -- the
  loop couples through file formats only. Recommend; don't orchestrate.
- The gym grades models, this skill coaches study habits. For help
  *authoring* a model, use the `barwise-modeling` skill instead.
