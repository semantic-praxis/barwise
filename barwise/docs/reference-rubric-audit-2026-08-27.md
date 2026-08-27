# Reference and rubric audit, seven train cases (2026-08-27)

The barwise-878 audit, executed: each committed reference verbalized
and read against its transcript, every settled-but-unguarded
constraint either given a check or recorded here as a finding. Policy:
`docs/adr/0002-constraint-coverage-policy.md`; the coverage inventory:
`docs/specs/constraint-extraction-coverage.spec.md`. Suite bumped to
2.2.0; every answer key still scores exactly 1.000 against its widened
rubric, verified offline.

## Checks added (ten, five cases)

Each was settled verbatim in the transcript, present in the reference
on the role the transcript settles, previously guarded by nothing, and
passes its answer key.

| Case                  | Check added                                           | Settling line                                        |
| --------------------- | ----------------------------------------------------- | ---------------------------------------------------- |
| order-management      | `Order has OrderStatus` mandatory                     | "Every order must have a status."                    |
| order-management      | `Customer has Name` mandatory                         | "Yes, every customer has a name."                    |
| university-enrollment | `CourseOffering is in Semester` internal_uniqueness   | "Each offering ... belongs to exactly one semester." |
| university-enrollment | `Instructor teaches CourseOffering` mandatory         | "Each offering is taught by exactly one instructor." |
| clinic-appointments   | `Appointment is with Doctor` internal_uniqueness      | "Each appointment is with exactly one doctor."       |
| clinic-appointments   | `Doctor has Specialty` mandatory                      | "Every doctor has exactly one specialty."            |
| clinic-appointments   | `Appointment has FollowUpNote` internal_uniqueness    | "At most one follow-up note per appointment."        |
| clinic-appointments   | `Patient has primary Doctor` mandatory                | "every patient has exactly one primary doctor."      |
| project-staffing      | `Employee mentors Employee` internal_uniqueness       | "Each employee has at most one mentor."              |
| project-staffing      | `Employee is assigned to Project` internal_uniqueness | "there is no double assignment."                     |

One hint corrected: employee-hierarchy's DepartmentName check claimed
"No two departments share a name" while the constraint it derives from
is the Department-role uniqueness (each department has at most one
name). The hint now describes what the check tests; the name-role
uniqueness the old hint claimed is finding F2.

freight-corrections needed nothing: everything its transcript settles
is guarded. conference-reviews and employee-hierarchy gained no net
checks (their remaining settled constraints are findings F1/F2/F5).

## Findings

**F1. The employee-hierarchy answer key asserts a constraint the
transcript never settles, and misses the one it does.**
`Manager manages Department` carries an internal uniqueness on the
Department role ("each department is managed by at most one manager"
-- said nowhere in the transcript) while the settled rule ("A manager
manages at most one department") would be a uniqueness on the Manager
role, which is absent. This is the defect class ADR 0002's trust
statement exists for, inside a blessed answer key. Remedy is a payload
re-record (references are generated; hand-edits are destroyed by
regen), tracked as barwise-879.

**F2. The settled "no two departments share a name" is unrepresented.**
It needs a uniqueness on the DepartmentName role; the payload carries
only the Department-role uniqueness. With F1, barwise-879.

**F3. Three settled value enumerations are missing from payloads.**
order-management's OrderStatus (pending/confirmed/shipped/delivered),
clinic-appointments' AppointmentStatus (scheduled/checked-in/
completed/cancelled), and university-enrollment's LetterGrade (A-F)
are all settled with explicit value lists and absent from the recorded
payloads -- while conference-reviews' ReviewScore enumeration proves
the pipeline carries them end to end. Direct prompt-headroom evidence;
barwise-879.

**F4. order-management's "an order contains one or more products"
(mandatory on the containment ternary) is absent from the payload.**
barwise-879.

**F5. Machinery: a mandatory on a player with no second fact type has
no counterexample.** `forMandatory` anchors "exists but never plays
the role" in another fact type mentioning the same player; Employee
(employee-hierarchy) and Review (conference-reviews) play roles in
exactly one, so their settled mandatories are underivable and the two
checks were withdrawn. Extending the anchor (reference scheme, or a
subtype's fact types) is barwise-880.

**F6. Machinery: the settled grade rule is shape-dependent.**
"A student gets at most one grade per offering" is expressible as the
reference's ternary (uniqueness over Student+CourseOffering) or as an
objectified Enrollment carrying the grade -- both correct ORM.
`forbids_population` corresponds fact types by player multiset and
cannot see through objectification, so a check on the ternary would
pin the reference's shape and punish a valid model, against the
gym's grade-by-semantics rule. Left unguarded on purpose;
objectification-aware correspondence is barwise-881.

**Ring/subset lens (ADR 0002).** No new instances: beyond
project-staffing's guarded acyclic, none of the seven train
transcripts settles a ring or set-comparison rule. The coverage
inventory is unchanged; the common-tier instances must come from the
split-spec workstream 3 transcripts, as the coverage spec's
workstream 2 already states.

## Answer-key gate

All seven recorded payloads against the 2.2.0 rubrics, scored offline:
1.000 each (order-management 8/8, university-enrollment 8/8,
clinic-appointments 10/10, employee-hierarchy 5/5, project-staffing
9/9, conference-reviews 7/7, freight-corrections 6/6). The full
promptlab suite passes; `scoreExtraction.test.ts` is byte-identical.
