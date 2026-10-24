# Review-tier reach: refuse an exact path whose name lives elsewhere unreached

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-1046
Touches: barwise/scripts/lib/review-tiers.mjs, barwise/scripts/check-review-tiers.mjs, barwise/review-tiers.json, barwise/scripts/tests/gates.test.mjs

## Principle

`check:review-tiers` answers "does every checklist heading have a row,
and does every glob match something?" It cannot answer "does the row
reach what its heading says?", and that is where barwise-1046's defect
lived. The instructions row listed `CLAUDE.md`, an exact path in this
table's pattern language, so it matched the root file and none of the
thirteen package and optimizer `CLAUDE.md` files. The gate stayed green
because the glob matched one file.

The general question -- what would a reader of this heading expect the
row to reach? -- is semantic, and no gate derives it from heading text.
But the CLAUDE.md defect has a narrower, mechanical shape: an exact path
whose file name also exists at other tracked paths the row does not
reach. That shape is checkable from the table and `git ls-files` alone,
and it is the instance of "define errors out of existence" this gate can
afford: one central check instead of an expected-coverage number every
author types.

## What should ship? (resolved: an exact-path shadow gate, plus an acknowledgement field on the rows that need one)

When a row's exact-path glob names a file whose name (the last path
segment) also appears at tracked paths the row does not reach, and the
row does not acknowledge that glob as deliberately one file, the gate
shall fail and name the glob and the count of unreached same-named
files.

Measured on the real table (commands in "Measurement" below):

| Table                                                    | Exact-path globs | Shadowed | Which                                                                                            |
| -------------------------------------------------------- | ---------------- | -------- | ------------------------------------------------------------------------------------------------ |
| Before the WS3 fix (`658e1f6f^`, 1637 tracked files)     | 11               | 3        | `CLAUDE.md` (13), `barwise/package.json` (13), the moved `.../prompts/builtins.generated.ts` (1) |
| Today (`origin/main` 8a97e619, 2154 tracked files)       | 18               | 2        | `barwise/packages/core/package.json` (13), `barwise/package.json` (13)                           |
| Today, with the instructions row reverted to `CLAUDE.md` | 16               | 3        | the two above, plus `CLAUDE.md` (13)                                                             |

On the pre-fix table every finding was a row that was later changed:
`CLAUDE.md` is barwise-1046 itself, the builtins path is barwise-fs0,
and the dependency row's `barwise/package.json` was rewritten in the
same WS3 commit (for over-firing, not under-reach -- an honest partial
hit). On today's table both findings read as deliberate on the row's
own `why` -- core's exports map, the root npm scripts -- so each gets
one acknowledgement entry, and that is the whole migration.

The replayed defect is the acceptance case: today's gate passes the
reverted instructions row with exit 0, and the new check must fail it.

## Scope

In scope:

- When an exact-path glob (a pattern not ending in `/` whose last
  segment is not `*`) in `rows` or `failureModes` has a last segment
  that also ends a tracked path the row's globs do not match, and the
  row's acknowledgement list does not name that glob, the gate shall
  exit 1 naming the row, the glob, and the unreached count.
- When an acknowledgement names a glob the row does not carry, or a
  glob that no longer has a same-named unreached file, the gate shall
  exit 1 naming it as stale -- the both-ways rule the gate already
  applies to headings.
- When the acknowledgement field is present but not an array of
  non-empty strings, the table reader shall throw, so the gate exits 2,
  as it does for every other malformed row field today.
- When the table, the checklist, REVIEW.md or the tracked-file list
  cannot be read, the gate shall keep exiting 2 (unchanged paths; the
  new check adds no input).

Out of scope:

- The `trivial` allow-list. A trivial glob that reaches too little
  errs toward more review, which is the safe direction; a shadow check
  there adds a field and protects nothing. Today `.beads/issues.jsonl`
  has no same-named file elsewhere anyway.
- Directory-glob reach. The same idea for directories (a directory glob
  whose last segment names other tracked directories the row does not
  reach) fires on 34 of 51 directory globs today -- `src/` alone shows
  326 unreached files -- so it cannot be a gate, and as a survey it is
  noise (see Alternatives).
- Re-checking the one fixed row. The instance is fixed; this is about
  the mechanism.

## Inventory

| Path                                     | Today                                                                                | Change                                                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `barwise/scripts/lib/review-tiers.mjs`   | `validateRows` checks heading, tier, why, globs; `matchesPattern` is the one matcher | validate the acknowledgement field; export a pure `shadowedGlobs(rows, tracked)` returning findings and stale entries |
| `barwise/scripts/check-review-tiers.mjs` | completeness both ways, zero-match globs (barwise-fs0), exit 0/1/2                   | call `shadowedGlobs` beside the zero-match check; print each finding; same exit contract                              |
| `barwise/review-tiers.json`              | 14 rows, 8 failure modes, 1 trivial glob                                             | acknowledge the two deliberate globs; one sentence in `$comment`                                                      |
| `barwise/scripts/tests/gates.test.mjs`   | check-review-tiers tests drive the gate with `--table` / `--tracked` fixtures        | add a shadowed-glob case, an acknowledged case, a stale-acknowledgement case, and a malformed-field refusal (exit 2)  |

`pr-risk.mjs` reads rows through the same `tierRows`; an extra optional
field changes nothing it computes. The checklist and REVIEW.md are
untouched.

## Alternatives considered

- **(a) Refuse a glob that matches zero tracked files.** Already
  shipped, by barwise-fs0, after the issue was filed: the gate fails on
  a dead glob. Today 0 of 70 non-`**` patterns match nothing. It would
  not have caught barwise-1046 -- `CLAUDE.md` matched one file -- though
  on the pre-fix table it would have flagged the same row through its
  other glob, `barwise/.claude/` (0 matches), which is luck, not reach.
- **(b) A per-row expected-coverage field the author writes (a count,
  or a file that must match).** Rejected on two measurements. First, it
  catches barwise-1046 only if the author's expectation is formed apart
  from the matcher. The cheapest way to fill a count is to run the
  matcher and paste the answer, which would have recorded the wrong
  reach as the expected one (the row matched 22 files, and 22 is what
  would have been typed); a must-match file catches it only if the
  author thought to name a package `CLAUDE.md`, and an author who
  thought of one would have written the glob. The field is a shadow of
  intent that diverges exactly where intent was wrong. Second, a count
  churns: of the five rows whose globs did not change between
  2026-09-22 and today, all five changed count (surface 275 to 292,
  tests 427 to 555, scripts 44 to 96, specs 160 to 217, Python 21 to
  22), so an equality count fails on ordinary file additions and a
  floor (`>=`) gives up the "file moved out of reach" property it was
  for. The exact-path gate gets that property without a typed number: a
  new `barwise/packages/x/AGENTS.md` turns it red on the PR that adds
  the file.
- **(c) A near-miss survey with no gate: files sharing a name or a
  directory with a row's matches, but not matched.** Rejected as too
  noisy to read. Today it prints 507 files across 13 of the 15 routed
  rows. On the pre-fix table it printed 295 files across 8 of 9 rows,
  and the 13 package `CLAUDE.md` files were among them -- 4% of the
  output, with nothing to rank them above the 109 surface-row
  neighbours or the 87 on the wiring row. A reader shown that once
  stops reading it. Recorded here, per the acceptance criterion, as the
  reason no general survey ships.
- **Directory-name shadow (the exact-path idea extended to
  directories).** Fires on 34 of 51 directory globs today; rejected for
  the same reason as (c).

The recommended check is the exact-path slice of (c) with the noise
removed: on both tables it prints two or three lines, each one a row
worth a decision. Its blind spot is stated: it sees nothing about
directory globs, and a heading that over-claims through a directory
pattern stays a review question.

## Workstreams

### 1. Exact-path shadow check, with acknowledgements (one PR)

Add `shadowedGlobs` and the field validation to `lib/review-tiers.mjs`,
call it from the gate, and add the gate tests. Then watch it go red on
the real table with the exit status read directly (no pipe): before the
acknowledgements land it must exit 1 naming the two globs above. Add
the two acknowledgements, watch it exit 0, and run it with
`--table` pointing at the reverted-instructions fixture to watch it
exit 1 naming `CLAUDE.md`. Record those three exit codes in the PR
body.

The field and the check land together: the check without the field
cannot be green on today's table, and the field without the check is
an unread annotation.

## Open decisions (for review)

- **Ship this, or close the issue on (a) alone?** (a) already shipped
  and is honest about what it misses. This adds one function, one
  optional field on two rows, and four tests, and would have caught the
  instance that filed the issue. Recommend shipping.
- **Field name and placement.** A per-row array (proposed
  `"singleFile": ["barwise/package.json"]`) beside the globs it
  qualifies, or a per-glob object form that changes the shape of every
  `globs` array. Recommend the per-row array: two rows change, and no
  reader of `globs` does.
- **Is an acknowledgement stale when the shadow disappears?** Failing
  then matches the house rule that baselines enumerate exactly what is
  open, but it turns red on a PR that deletes an unrelated
  `package.json`. Recommend failing; it is rare and the fix is one line.
- **Is the wiring row's `barwise/package.json` really deliberate?** The
  twelve `barwise/packages/*/package.json` files also carry scripts and
  exports maps with siblings. The check forces this question; it does
  not answer it. Recommend acknowledging it now and filing a follow-up
  if the owner thinks package manifests belong on that row.
- **`trivial` excluded.** Recommend keeping it out, for the safe-direction
  reason in Scope.

## Risks and testing

- A reflexive acknowledgement silences the check. It is typed into the
  row beside the `why`, so it is visible in the diff that adds it, which
  is the same review the rest of the table gets.
- The gate's existing exits must not move: the existing check-review-tiers tests in
  `gates.test.mjs` keep passing, and the new malformed-field
  case asserts exit 2 rather than 1.
- `npm run fault-matrix` should still classify the gate as refusing
  under the git faults, since the new check reads only the tracked list
  the gate already refuses on.

## Non-goals

- No change to the pattern language or `matchesPattern`.
- No attempt to derive expected reach from heading text.
- No change to `pr-risk` output.

## Measurement

Reproduces every number above. Save as `barwise/reach.tmp.mjs`, run
`node reach.tmp.mjs` from `barwise/` for today, or
`node reach.tmp.mjs <old-table.json> 658e1f6f^` after
`git show 658e1f6f^:barwise/review-tiers.json > <old-table.json>`, then
delete it. The reverted-instructions row is today's table with
`barwise/packages/*/CLAUDE.md` and `barwise/optimizer/CLAUDE.md`
removed from the instructions row; `node scripts/check-review-tiers.mjs
--table <that file>` exits 0 today.

```js
import { execSync } from "node:child_process";
import * as t from "./scripts/lib/review-tiers.mjs";
const [table = t.TABLE, ref] = process.argv.slice(2);
const files = execSync(
  ref ? `git ls-tree -r --name-only ${ref}` : "git ls-files",
  {
    encoding: "utf8",
    cwd: "..",
  },
).split("\n").filter(Boolean);
let fm = [];
try {
  fm = t.failureModeRows(table);
} catch {}
const rows = [...t.tierRows(table), ...fm].filter((r) =>
  r.globs && !r.globs.includes("**")
);
const name = (f) => f.split("/").at(-1);
const dir = (f) => f.split("/").slice(0, -1).join("/");
let dead = 0, near = 0, nearRows = 0, dirShadow = 0, globs = 0;
const exact = [];
for (const r of rows) {
  const hit = (f) => r.globs.some((g) => t.matchesPattern(f, g));
  const m = files.filter(hit);
  const names = new Set(m.map(name)), dirs = new Set(m.map(dir));
  const n = files.filter((f) =>
    !hit(f) && (names.has(name(f)) || dirs.has(dir(f)))
  ).length;
  near += n;
  nearRows += n > 0;
  for (const g of r.globs) {
    globs++;
    if (!files.some((f) => t.matchesPattern(f, g))) dead++;
    const last = name(g.replace(/\/$/, ""));
    if (last === "*") continue;
    const miss = g.endsWith("/")
      ? files.filter((f) => dir(f).split("/").includes(last) && !hit(f))
      : files.filter((f) => name(f) === last && !hit(f));
    if (miss.length && g.endsWith("/")) dirShadow++;
    if (miss.length && !g.endsWith("/")) {
      exact.push(`${r.heading} :: ${g} (${miss.length})`);
    }
  }
}
console.log(`files ${files.length}, globs ${globs}, zero-match ${dead}`);
console.log(
  `near-miss (shared basename or dir): ${near} files over ${nearRows} of ${rows.length} rows`,
);
console.log(`directory-name shadow: ${dirShadow} directory globs`);
console.log(
  `exact-path basename shadow: ${exact.length}\n  ${exact.join("\n  ")}`,
);
```

Today it prints 69 globs (the `**` rows excluded; with the one trivial
glob that is the 70 the gate checks), 0 zero-match, 507 near-miss files
over 13 of 15 rows, 34 directory-name shadows, and the two exact-path
shadows. On `658e1f6f^`: 26 globs, 2 zero-match, 295 near-miss files
over 8 of 9 rows, 5 directory-name shadows, and the three exact-path
shadows.
