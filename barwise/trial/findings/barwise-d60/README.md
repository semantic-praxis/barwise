# barwise-d60: acceptance checks name concepts a skin's physical naming renames

Not a format limit, and not plainly an importer defect: a question
about how to grade an artifact whose names are not the model's.

## Reproduction

```sh
npm run trial:generate -- --customer C03 --tier small
grep -n "CREATE TABLE" trial/customers/C03-insurer/generated/small/pc-ddl.sql | head
npm run trial:offline -- --customer C03 --sprint 6
```

C03's skin (`skins/redshift-pc.yaml`) prefixes every table `pc_`, so
`pc_policy` imports as `PcPolicy` and the policy-admin DBA's check "The
model has no object type named Policy" fails. The same shape, by other
means:

- C05 and C10 abbreviate through vendor dictionaries (`MAT`, `WERK`;
  `SPRIDEN`, `SGBSTDN`).
- C12 truncates every identifier to 8 characters.
- C07's BigQuery skin writes no `FOREIGN KEY`, so a relationship the
  persona checks for is never stated.

Expected: a decision. Either the trial grader maps a check's names
through the skin's own naming rules before grading, so these rows test
structure; or the import gains a naming map and common-prefix
stripping, which real legacy schemas would use.

Observed (2026-10-08): 11 acceptance rows (C03, C05, C07, four C10,
four C12) fail mostly on names, after the barwise-1077 triage moved
everything else out of them.
