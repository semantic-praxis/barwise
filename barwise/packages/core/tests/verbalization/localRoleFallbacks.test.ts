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

/** Verbalizers whose kind `requiresLocalRoles` marks false. */
const SPANNING_VERBALIZERS = new Set([
  "verbalizeExternalUniqueness",
  "verbalizeDisjunctiveMandatory",
  "verbalizeExclusion",
  "verbalizeExclusiveOr",
  "verbalizeSubset",
  "verbalizeEquality",
]);

const FALLBACK = /\?\?\s*(roleId\b|rid\b|roleIds1?\[|roleIds2\[|subsetRoleIds\[|supersetRoleIds\[)/;
const FUNCTION = /^(?:export )?function (verbalize\w+)/;

/** Each role-id fallback in a file, tagged with the function it sits in. */
function fallbacksByFunction(file: string): { fn: string; line: number; text: string; }[] {
  const lines = readFileSync(join(CONSTRAINTS_DIR, file), "utf8").split("\n");
  const found: { fn: string; line: number; text: string; }[] = [];
  let fn = "<file scope>";
  lines.forEach((text, i) => {
    const m = FUNCTION.exec(text);
    if (m) fn = m[1]!;
    if (FALLBACK.test(text)) found.push({ fn, line: i + 1, text: text.trim() });
  });
  return found;
}

describe("role-id fallbacks live only in the spanning-kind verbalizers", () => {
  for (const file of ["phase1.ts", "phase2.ts"]) {
    it(`${file} has none in a local-role verbalizer`, () => {
      const offenders = fallbacksByFunction(file)
        .filter((f) => !SPANNING_VERBALIZERS.has(f.fn))
        .map((f) => `${file}:${f.line} in ${f.fn}: ${f.text}`);

      expect(offenders).toEqual([]);
    });
  }

  it("finds the fallbacks that are supposed to be there", () => {
    // Without this the regex could stop matching and the test above
    // would pass by seeing nothing at all.
    const all = [...fallbacksByFunction("phase1.ts"), ...fallbacksByFunction("phase2.ts")];
    expect(all.length).toBeGreaterThan(0);
    expect(new Set(all.map((f) => f.fn))).toEqual(SPANNING_VERBALIZERS);
  });
});
