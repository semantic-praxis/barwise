/**
 * The other direction of the universe-rule table.
 *
 * `UNIVERSE_RULES` is `as const satisfies readonly UniverseRule[]`, so a
 * rule that does not take a universe cannot be listed and a rule that
 * takes one and is left out never receives it. What the type cannot say
 * is that a NEW rule must not fetch the universe for itself instead of
 * joining the list -- and that is exactly how the set became a copy in
 * the first place, five rules each calling `buildObjectUniverse`
 * (docs/specs/object-universe-as-a-parameter.spec.md).
 *
 * So: a source scan. `mandatory.ts` is the one exception, and it is
 * named rather than pattern-matched -- its two `*ViolationsFor` helpers
 * are called by `constraintEnforcement.ts` with a model and a single
 * constraint, so they have no dispatcher to receive a universe from.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ABSENT_DATA_RULES,
  UNIVERSE_RULES,
} from "../../src/validation/rules/populationValidation.js";

const RULES_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/validation/rules/population",
);

/** The only module allowed to build the universe for itself. */
const ALLOWED = new Set(["shared.ts", "mandatory.ts"]);

describe("the universe-rule table", () => {
  it("is the only way a population rule gets the object universe", () => {
    const offenders = readdirSync(RULES_DIR)
      .filter((f) => f.endsWith(".ts") && !ALLOWED.has(f))
      .filter((f) => readFileSync(join(RULES_DIR, f), "utf8").includes("buildObjectUniverse"));

    assert.deepEqual(
      offenders,
      [],
      `these modules build the object universe themselves instead of taking it as a `
        + `parameter and joining UNIVERSE_RULES: ${offenders.join(", ")}`,
    );
  });

  it("scans the directory it means to scan", () => {
    // A scan that enumerates nothing reports OK. barwise-905 is the
    // whole reason this line exists: the count is the only tell.
    const scanned = readdirSync(RULES_DIR).filter((f) => f.endsWith(".ts"));
    expect(scanned.length).toBeGreaterThanOrEqual(10);
    expect(scanned).toContain("mandatory.ts");
  });

  it("keeps the absent-data rules a subset of the universe rules", () => {
    // Enforced by the type as well; asserted because a `satisfies` that
    // is silently loosened later would go unnoticed, and this is one
    // line.
    for (const rule of ABSENT_DATA_RULES) {
      expect(UNIVERSE_RULES).toContain(rule);
    }
    expect(ABSENT_DATA_RULES.length).toBeLessThan(UNIVERSE_RULES.length);
  });
});
