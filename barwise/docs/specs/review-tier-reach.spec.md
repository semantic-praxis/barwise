# Review-tier reach: refuse a file-shaped pattern whose name lives elsewhere unreached

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-1046
Touches: barwise/scripts/lib/review-tiers.mjs, barwise/scripts/check-review-tiers.mjs, barwise/review-tiers.json, barwise/scripts/tests/gates.test.mjs

## Principle

`check:review-tiers` answers two questions: does every checklist heading
have a row, and does every pattern match something? It cannot answer
"does the row reach what its heading says?", and that is where
barwise-1046's defect lived. The instructions row listed `CLAUDE.md`,
an exact path in this table's pattern language, so it matched the root
file and none of the thirteen package and optimizer `CLAUDE.md` files.
The gate stayed green because the pattern matched one file.

The general question -- what would a reader of this heading expect the
row to reach? -- is semantic, and no gate can derive it from heading
text. But the CLAUDE.md defect has a narrower, mechanical shape: a
pattern that names one file, whose file name also appears at other
tracked paths the row does not reach. That shape is checkable from the
table and the tracked-file list alone. Checking it once, centrally, is
how this gate can "define errors out of existence", instead of asking
every author to type an expected-coverage number.

## Terms

A **file-shaped pattern** is a pattern in `review-tiers.json`'s language
that does not end in `/`, is not `**`, and whose final segment is a
literal file name. Earlier segments may be literal or `*`. So
`CLAUDE.md`, `barwise/package.json` and `barwise/packages/*/CLAUDE.md`
are file-shaped. `barwise/scripts/` and `a/*` are not: a directory has
no file name to compare, and a final `*` names no file.

A file-shaped pattern's **shadow** is the set of tracked files whose
final segment equals the pattern's final segment and which no pattern
in the same row matches.

## What should ship? (resolved: a shadow gate, with acknowledgements that list exactly what they waive)

When a row's file-shaped pattern has a non-empty shadow, the gate shall
fail unless the row's `reachAcknowledged` entry for that pattern lists
exactly that shadow.

Measured with the script in "Measurement" below. Each figure says which
tree it comes from:

| Tree and table                                                   | File-shaped entries | With a shadow | Which (shadow size)                                                                              |
| ---------------------------------------------------------------- | ------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| Before the WS3 fix: `658e1f6f^` (a3d853d4), 1637 files           | 11                  | 3             | `CLAUDE.md` (13), `barwise/package.json` (13), the moved `.../prompts/builtins.generated.ts` (1) |
| Today: `origin/main` at 8a97e619, 2154 files                     | 18                  | 2             | `barwise/packages/core/package.json` (13), `barwise/package.json` (13)                           |
| 8a97e619 with the instructions row put back to `CLAUDE.md` alone | 16                  | 3             | the two above, plus `CLAUDE.md` (13)                                                             |

On the pre-fix table, all three findings were rows that were later
changed. `CLAUDE.md` is barwise-1046 itself. The builtins path is
barwise-fs0. The dependency row's `barwise/package.json` was rewritten
in the same WS3 commit, but because it fired too often, not because it
reached too little -- so that one is a partial hit.

Today's two findings are not alike:

- **The core row's `barwise/packages/core/package.json`** reaches core's
  exports map on purpose. Its shadow is the other twelve manifests, the
  workspace manifest, and the root `package.json`, and none of those is
  core. The row's own `why` says so: acknowledge it.
- **The wiring row's `barwise/package.json`** has the root
  `package.json` in its shadow. That file is the generated npm-script
  forwarder (`scripts/regen-root-package.mjs`), so it is a sibling of
  `barwise/package.json`'s scripts. "Wired in one place, not its
  siblings" is about exactly that. It is a real finding on today's
  table, and this spec does not waive it. Open decision 2 asks whether
  to widen the row.

The put-back instructions row is the acceptance case. Today's gate
passes it with exit 0
(`node scripts/check-review-tiers.mjs --table <that file>`), and the new
check must fail it.

## Scope

In scope:

- When a file-shaped pattern in `rows` or `failureModes` has a
  non-empty shadow and the row has no `reachAcknowledged` entry for it,
  the gate shall exit 1, naming the row, the pattern, and the shadow.
- When a row's `reachAcknowledged` entry for a pattern differs from that
  pattern's shadow, the gate shall exit 1, naming each path that is in
  the shadow but not acknowledged (a new shadow) and each acknowledged
  path that is no longer in the shadow (stale).
- When a `reachAcknowledged` key is not a file-shaped pattern of the
  same row, the gate shall exit 1 and name the key as stale.
- When `reachAcknowledged` is present but is not an object whose values
  are arrays of non-empty strings, the gate shall exit 2.
- When the table, the checklist, REVIEW.md or the tracked-file list
  cannot be read, the gate shall still exit 2. These paths do not
  change, and the new check reads no new input.

The field records what it waives, and that is the design. A waiver
that names a shadow by membership stops covering anything the moment a
new same-named file appears: the new file fails the gate on the PR that
adds it. A rule that only checks "at least one shadow remains" would
waive every future file with that name, forever.

Out of scope:

- The `trivial` allow-list. A trivial pattern that reaches too little
  only causes more review, which is the safe direction. A shadow check
  there adds a field and protects nothing. Today `.beads/issues.jsonl`
  has an empty shadow anyway.
- Reach of directory patterns. The same idea applied to directories --
  a directory pattern whose last segment names other tracked
  directories the row does not reach -- fires on 34 of 51 directory
  entries today. `barwise/packages/core/src/` alone has 326 unreached
  files under other `src/` directories. It cannot be a gate, and as a
  survey it is noise. Reach through directory patterns stays a review
  question.
- Re-checking the one fixed row. The instance is fixed; this spec is
  about the mechanism.

## Inventory

| Path                                     | Today                                                                                                                  | Change                                                                                                                                                       |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `barwise/scripts/lib/review-tiers.mjs`   | `validateRows` checks heading, tier, why, globs, shared by the gate and `pr-risk`; `matchesPattern` is the one matcher | export a pure `shadowedPatterns(rows, tracked)` that validates `reachAcknowledged` itself (throws on a malformed one) and returns findings and stale entries |
| `barwise/scripts/check-review-tiers.mjs` | completeness both ways, zero-match patterns (barwise-fs0), exit 0/1/2                                                  | call `shadowedPatterns` beside the zero-match check, inside the existing try block, so a malformed field exits 2; print each finding                         |
| `barwise/review-tiers.json`              | 14 rows, 8 failure modes, 1 trivial pattern                                                                            | `reachAcknowledged` on the core row; the wiring row per Open decision 2; one sentence in `$comment`                                                          |
| `barwise/scripts/tests/gates.test.mjs`   | the check-review-tiers tests drive the gate with `--table` / `--tracked` fixtures                                      | add cases for: a shadow with no acknowledgement, an exact acknowledgement, a new shadow path, a stale path, a stale key, and a malformed field (exit 2)      |

`pr-risk.mjs` reads rows through `tierRows` and never reads
`reachAcknowledged`. The field is validated in `shadowedPatterns`, not
in `validateRows`, so `pr-risk` is unaffected by it (see Risks). The
checklist and REVIEW.md do not change.

## Alternatives considered

- **(a) Refuse a pattern that matches zero tracked files.** This is
  already built. barwise-fs0 added it after this issue was filed. Today
  the gate walks 73 pattern entries (62 distinct, counting the three
  `**` entries and the one trivial pattern), and none matches nothing.
  It could not have flagged `CLAUDE.md`, which matched one file. On the
  pre-fix table it would have flagged two dead entries, the builtins
  path and `barwise/.claude/`. The second sits on the instructions row,
  so it would have pointed a reader at the right row by luck, not by
  checking reach.

- **(b) A per-row expected-coverage field the author writes: a count, or
  a file that must match.** Rejected, for two measured reasons.

  First, it catches barwise-1046 only if the author forms the
  expectation without the matcher. The cheapest way to fill in a count
  is to run the matcher and paste the result. On the pre-fix table
  that would have recorded the instructions row's 22 files, the wrong
  reach, as the expected reach. A must-match file catches it only if
  the author thought to name a package `CLAUDE.md`, and an author who
  thought of one would have written the pattern. The field shadows
  intent, and it goes wrong exactly where the intent does.

  Second, a count goes stale fast. Five rows kept identical patterns
  between `658e1f6f^` (a3d853d4, 2026-09-22) and 8a97e619, and all five
  changed count: surface 275 to 292, tests 427 to 555, scripts 44 to 96,
  specs 160 to 217, Python 21 to 22. An exact count fails on ordinary
  file additions. A floor (`>=`) gives up the "file moved out of reach"
  property the field was for. The shadow gate gets that property
  without a typed number, and its acknowledgements change far less. The
  two shadow lists compared across the same window (the `package.json`
  set, 13 paths) are identical at both trees, so zero edits would have
  been needed.

- **(c) A near-miss survey with no gate: files that share a name or a
  directory with a row's matches, but are not matched.** Rejected as a
  general survey. Kept, after grouping by name, as the source of the
  recommended gate.

  Today it reports 507 row-file pairs, which is 234 distinct files,
  across 13 of 15 routed rows. On the pre-fix table it reports 295
  pairs, which is 173 distinct files, across 8 of 9 routed rows. That
  table's largest rows are surface (86 near-misses) and core (94). The
  13 package `CLAUDE.md` files are 7.5% of the 173 distinct files.

  Read one row at a time it looks better. On the pre-fix instructions
  row, 13 of 26 near-misses (50%) were those files, and grouping the
  row's same-named near-misses puts `CLAUDE.md` (13) first. So a
  per-row survey grouped by name would have shown the defect at the top
  of its row. But that grouping puts noise at the top of most rows too.
  The pre-fix top groups are `index.ts` (20) on surface, `index.ts` (14)
  on core, and `CLAUDE.md` (13) again on the Python row, where it means
  nothing: `barwise/optimizer/` matched the optimizer's `CLAUDE.md` and
  made every other `CLAUDE.md` a near-miss.

  The groups that carry a finding are exactly the ones whose name comes
  from a file-shaped pattern. The groups that do not come from names a
  directory pattern happened to match. Keeping only the first kind turns
  (c) into the recommended gate. That changes what (c) contributes, not
  the verdict on a general survey: none ships, and this paragraph is the
  record of why, as the acceptance criterion requires.

- **Directory-name shadow.** It fires on 34 of 51 directory entries
  today. Rejected for the same reason as the general survey.

The recommended check is the name-grouped slice of (c) with the noise
removed. On the three tables above it reports two or three patterns,
and each one is a row worth deciding about. Its blind spot is stated in
Scope.

## Workstreams

### 1. Shadow check, with exact acknowledgements (one PR)

Add `shadowedPatterns` to `lib/review-tiers.mjs`, call it from the gate,
and add the gate tests. Then watch it go red on the real table, reading
each exit status directly, not through a pipe:

1. Before any acknowledgement lands, the gate must exit 1 and name the
   two patterns above.
2. Settle the wiring row (Open decision 2) and add the acknowledgements.
   The gate must exit 0.
3. With `--table` pointing at the put-back instructions row, the gate
   must exit 1 and name `CLAUDE.md` with its 13-path shadow.

Record those three exit codes in the PR body. The field and the check
land together: the check alone cannot be green on today's table, and
the field alone is an annotation nothing reads.

## Open decisions (for review)

1. **Ship this, or close the issue on (a) alone?** (a) already shipped
   and is honest about what it misses. This adds one function, one
   optional field, and six tests, and it would have caught the instance
   that filed the issue. Recommend shipping.
2. **The wiring row and the root forwarder.** Either widen the row to
   reach the root `package.json`, by adding `package.json` to its
   patterns, or acknowledge it. Recommend widening: the forwarder is the
   sibling the failure mode names, and the gate found it on its first
   run. Widening leaves the twelve `barwise/packages/*/package.json`
   files in the shadow of both manifest patterns. That is a separate
   question: either acknowledge them (their scripts are not forwarded --
   the forwarder runs `npm --prefix barwise`), or widen further to
   `barwise/packages/*/package.json`. Recommend acknowledging them, and
   letting the owner widen if package manifests count as wiring
   siblings.
3. **Acknowledge by exact list, or by count?** The two churn equally
   often: either one needs an edit whenever a same-named file appears
   or disappears. Measured over 2026-09-22 to 8a97e619, that was never
   for the shadows in question. The list is longer -- 13 paths for the
   core row today, and up to 25 more depending on decision 2. A count
   is one number, but it misses a swap: one manifest removed and
   another added in the same PR leaves the count unchanged and waives a
   file nobody looked at. Recommend the exact list.
4. **Field name and shape.** Recommend
   `"reachAcknowledged": { "<pattern>": ["<path>", ...] }` on the row,
   beside the patterns it qualifies. A per-pattern object would change
   the shape of every `globs` array that every reader walks.
5. **`trivial` excluded.** Recommend keeping it out, for the
   safe-direction reason in Scope.

## Risks and testing

- **`pr-risk` stays available.** If the field were validated in
  `validateRows`, `pr-risk` would refuse (exit 2) over a malformed field
  it never reads, and the Copilot workflow would turn that refusal into
  "request the review" on every PR. That would be safe, but it ties
  `pr-risk`'s availability to a field it does not use. So the field is
  validated in `shadowedPatterns` instead, which runs only in the gate.
  The gate runs in CI on the PR that introduces a malformed field, and
  exits 2 there.
- **A reflexive acknowledgement silences the check.** Because the field
  lists paths, a waiver covers only what it names. It sits beside the
  row's `why`, in the diff that adds it, under the same review as the
  rest of the table.
- **The gate's existing exits must not move.** The existing
  check-review-tiers tests in `gates.test.mjs` keep passing, and the
  malformed-field case asserts exit 2, not 1.
- **`npm run fault-matrix`** should still classify the gate as refusing
  under the git faults. The new check reads only the tracked list,
  which the gate already refuses on.

## Non-goals

- No change to the pattern language or `matchesPattern`.
- No attempt to derive expected reach from heading text.
- No change to `pr-risk` output.

## Measurement

The script below prints every figure in this spec. Save it as
`barwise/reach.tmp.mjs`, run it from `barwise/`, then delete it.

- `node reach.tmp.mjs 8a97e619` gives today: the tree and table at that
  commit.
- `node reach.tmp.mjs 658e1f6f^` gives the pre-fix table.
- `node reach.tmp.mjs 8a97e619 <file>` gives the put-back row, where
  `<file>` is today's table with `barwise/packages/*/CLAUDE.md` and
  `barwise/optimizer/CLAUDE.md` removed from the instructions row.

The count churn in (b) is the per-row "matched" column compared across
the first two runs, for the five rows whose patterns are identical in
both tables. The 44 for scripts is from a3d853d4 (`658e1f6f^`).

```js
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as t from "./scripts/lib/review-tiers.mjs";

// node reach.tmp.mjs <ref> [table-file]: the tree and (by default) the table at <ref>.
const [ref, tableArg] = process.argv.slice(2);
if (!ref) throw new Error("usage: node reach.tmp.mjs <ref> [table-file]");
const git = (cmd) =>
  execSync(`git ${cmd}`, { encoding: "utf8", cwd: "..", maxBuffer: 1 << 26 });
const files = git(`ls-tree -r --name-only ${ref}`).split("\n").filter(Boolean);
let table = tableArg;
if (!table) {
  table = join(mkdtempSync(join(tmpdir(), "reach-")), "review-tiers.json");
  writeFileSync(table, git(`show ${ref}:barwise/review-tiers.json`));
}
const raw = JSON.parse(readFileSync(table, "utf8"));
// A table from before failureModes or trivial existed has no key; a present but malformed one refuses.
const modes = "failureModes" in raw ? t.failureModeRows(table) : [];
const all = [...t.tierRows(table), ...modes];
const trivial = "trivial" in raw ? t.trivialGlobs(table) : [];
const name = (f) => f.split("/").at(-1);
const dir = (f) => f.split("/").slice(0, -1).join("/");
const reaches = (g) => files.some((f) => t.matchesPattern(f, g));

const entries = [...all.flatMap((r) => r.globs ?? []), ...trivial];
console.log(
  `ref ${
    git(`rev-parse --short ${ref}`).trim()
  }, ${files.length} tracked files`,
);
console.log(
  `pattern entries walked ${entries.length}, distinct ${
    new Set(entries).size
  }, zero-match ${entries.filter((g) => !reaches(g)).length}`,
);

const routed = all.filter((r) => r.globs && !r.globs.includes("**"));
const distinct = new Set();
let pairs = 0, flagged = 0;
const fileShaped = [], dirs = [];
console.log(
  "\nper row: matched | near-miss | of which same-name | largest same-name group",
);
for (const r of routed) {
  const hit = (f) => r.globs.some((g) => t.matchesPattern(f, g));
  const m = files.filter(hit);
  const names = new Set(m.map(name)), ds = new Set(m.map(dir));
  const near = files.filter((f) =>
    !hit(f) && (names.has(name(f)) || ds.has(dir(f)))
  );
  const same = near.filter((f) => names.has(name(f)));
  const groups = Object.entries(Object.groupBy(same, name)).sort((a, b) =>
    b[1].length - a[1].length
  );
  const top = groups[0] ? `${groups[0][0]} (${groups[0][1].length})` : "-";
  near.forEach((f) => distinct.add(f));
  pairs += near.length;
  flagged += near.length > 0;
  console.log(
    `  ${
      r.heading.slice(0, 48).padEnd(48)
    } ${m.length} | ${near.length} | ${same.length} | ${top}`,
  );
  for (const g of r.globs) {
    const last = name(g.replace(/\/$/, ""));
    if (g.endsWith("/")) {
      const miss = files.filter((f) =>
        dir(f).split("/").includes(last) && !hit(f)
      );
      dirs.push([g, miss.length]);
    } else if (last !== "*") {
      const miss = files.filter((f) => name(f) === last && !hit(f));
      fileShaped.push([`${r.heading.slice(0, 40)} :: ${g}`, miss]);
    }
  }
}
console.log(
  `near-miss: ${pairs} row-file pairs, ${distinct.size} distinct files, over ${flagged} of ${routed.length} routed rows`,
);
const shadowed = fileShaped.filter(([, miss]) => miss.length > 0);
console.log(
  `\nfile-shaped pattern entries ${fileShaped.length}, shadowed ${shadowed.length}`,
);
for (const [g, miss] of shadowed) {
  console.log(
    `  ${g} (${miss.length} unreached same-named)\n    ${miss.join("\n    ")}`,
  );
}
const dshadow = dirs.filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
console.log(
  `directory pattern entries ${dirs.length}, with an unreached same-named directory ${dshadow.length}, largest ${
    dshadow[0]?.join(" ") ?? "-"
  }`,
);
```
