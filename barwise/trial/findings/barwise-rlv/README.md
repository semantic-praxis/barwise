# barwise-rlv: the trial's DDL generator loses objectification and repeats self-reference columns

```sh
npm run trial:generate -- --customer C10 --tier small
grep -n -A4 "SCBCRSE_IS_PREREQUISITE_OF_SCB\|TABLE saturn.SFRSTCR " \
  trial/customers/C10-university/generated/small/sis-ddl.sql
npm run trial:generate -- --customer C03 --tier small
grep -n -A8 "TABLE public.pc_policy_period " \
  trial/customers/C03-insurer/generated/small/pc-ddl.sql
```

Expected: an objectified fact type is one table keyed on its roles, as
barwise's own exporter writes it since PR #600; a fact type whose two
roles share a player names each column after its role.

Observed (2026-10-08):

- C10's Enrollment is table `SFRSTCR` (its own `SFRSTCR_ID` key) and
  "Student enrolls in CourseSection for Term" is a second table,
  `SGBSTDN_ENROLLS_IN_SCBCRSE_SEC`; nothing links them, so the import has
  no "Enrollment is where ..." reading. C12's Determination likewise.
- C03's PolicyPeriod objectifies "Policy is in force for Term", but its
  policy number and the term land in different tables, so the generator
  cannot write `UNIQUE (policy_number, term_id)` and "The combination of
  PolicyNumber and Term is unique across fact types" is never stated.
- `SCBCRSE_IS_PREREQUISITE_OF_SCB` declares `SCBCRSE_ID` twice, and
  `pc_policy_period` declares `policy_period_id` twice (its supersedes
  self-reference), so neither table says which role is which.
- C10's skin lists three `extra_tables`, `SPRIDEN`, `SFRSTCR` and
  `STVTERM`, whose names the dictionary also gives the generated Person,
  Enrollment and Term tables, so the file creates each twice. The import
  keeps the first and drops the second; the grader maps none of the
  three, since the artifact does not say which one is Person (PR #611
  review).

The trial rows classified here are graded with their names mapped
through the skin (barwise-d60), so what fails is structure the artifact
does not state: C03 policy-admin-dba, C10 ir-analyst,
registrar-data-steward and sis-dba (whose Person is one of the
colliding names), C12 modernization-architect and policy-analyst.
C10's ir-analyst also fails "GraduateStudent is a subtype of Student",
which is barwise-1078 (a primary key that is also a foreign key).
