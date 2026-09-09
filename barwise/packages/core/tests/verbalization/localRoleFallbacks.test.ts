/**
 * Only the spanning kinds may keep a role-id fallback.
 *
 * `ConstraintVerbalizer.verbalize` screens the local-role kinds, so a
 * `?? roleId` inside one of their verbalizers is dead code a reader
 * cannot tell is dead -- and worse, it is the exact shape of the defect
 * this workstream removed: prose built from an id, indistinguishable
 * from a sentence about a real type. Three such fallbacks survived the
 * first pass of that removal and were found by counting, not by a
 * failing test, because unreachable code passes every test.
 *
 * So the invariant is checked over the source rather than the behaviour.
 * The spanning kinds keep theirs and must: a non-local role is correct
 * for exclusion, subset, equality, exclusive-or, disjunctive mandatory
 * and external uniqueness (barwise-979).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CONSTRAINTS_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/verbalization/constraints",
);

/**
 * Where a role-id fallback is allowed: code serving a kind
 * `requiresLocalRoles` marks false, for which a role of another fact
 * type is correct rather than a defect.
 *
 * `spanningRoleLabel` is here and holds no `??` today -- it degrades
 * with an explicit `if (!role)` instead, which this file's regex does
 * not match. It is listed because it is the shared degradation point
 * that `verbalizeSubset` and `verbalizeEquality` now route through
 * (barwise-884), so a `??` appearing there later is legitimate and
 * should not be reported.
 */
const SPANNING_FALLBACK_SITES = new Set([
  "verbalizeExternalUniqueness",
  "verbalizeDisjunctiveMandatory",
  "verbalizeExclusion",
  "verbalizeExclusiveOr",
  "spanningRoleLabel",
]);

/** How many of those sites hold a matching fallback today. */
const EXPECTED_FALLBACK_SITES = 4;

// `roleId[12]?` and not `roleId\b`: the ring and value-comparison
// verbalizers spell their parameters `roleId1`/`roleId2`, and `\b` does
// not match before a digit, so the first version of this gate was blind
// to exactly two of the seven kinds it exists to cover. Planting
// `?? roleId1` in `verbalizeValueComparison` left it green.
const FALLBACK =
  /\?\?\s*(roleId[12]?\b|rid\b|roleIds1?\[|roleIds2\[|subsetRoleIds\[|supersetRoleIds\[)/;
// Every top-level function, not only `verbalize*`: attributing a
// fallback to whichever `verbalize*` happens to precede it would exempt
// a helper that sits after a spanning verbalizer and is called from a
// local-role one. A top-level `const` ends the previous function for the
// same reason.
const FUNCTION = /^(?:export )?function (\w+)/;
const TOP_LEVEL_CONST = /^(?:export )?const \w/;

/** Each role-id fallback in a file, tagged with the function it sits in. */
function fallbacksByFunction(file: string): { fn: string; line: number; text: string; }[] {
  const lines = readFileSync(join(CONSTRAINTS_DIR, file), "utf8").split("\n");
  const found: { fn: string; line: number; text: string; }[] = [];
  let fn = "<file scope>";
  lines.forEach((text, i) => {
    const m = FUNCTION.exec(text);
    if (m) fn = m[1]!;
    else if (TOP_LEVEL_CONST.test(text)) fn = "<file scope>";
    if (FALLBACK.test(text)) found.push({ fn, line: i + 1, text: text.trim() });
  });
  return found;
}

describe("role-id fallbacks live only in the spanning-kind verbalizers", () => {
  for (const file of ["phase1.ts", "phase2.ts"]) {
    it(`${file} has none in a local-role verbalizer`, () => {
      const offenders = fallbacksByFunction(file)
        .filter((f) => !SPANNING_FALLBACK_SITES.has(f.fn))
        .map((f) => `${file}:${f.line} in ${f.fn}: ${f.text}`);

      expect(offenders).toEqual([]);
    });
  }

  it("finds the fallbacks that are supposed to be there", () => {
    // Without this the regex could stop matching and the test above
    // would pass by seeing nothing at all. Asserted as a subset with a
    // floor rather than an exact set: a legitimate site may hold no `??`
    // at a given moment (`spanningRoleLabel` does not), and the floor is
    // what stops the check degrading to "found almost nothing".
    const all = [...fallbacksByFunction("phase1.ts"), ...fallbacksByFunction("phase2.ts")];
    const sites = new Set(all.map((f) => f.fn));

    expect(all.length).toBeGreaterThan(0);
    expect(sites.size).toBe(EXPECTED_FALLBACK_SITES);
    expect([...sites].filter((fn) => !SPANNING_FALLBACK_SITES.has(fn))).toEqual([]);
  });
});
