/**
 * Every law file declares the premises its laws rest on.
 *
 * A law over generated inputs is only as strong as the inputs that
 * reach the branch it asserts on. `serialization.law.test.ts` states
 * the rule in one line -- "a generator that is too tame passes every
 * law and proves nothing" -- and four of the five law files acted on
 * it, each with a `describe("coverage: ...")` block counting the shapes
 * its laws need.
 *
 * `merge.law.test.ts` did not, for as long as it existed, and nothing
 * said so. Its two-draw laws asserted `[] toEqual []` in 127 pairs of
 * 250 on the objectification clause -- the clause guarding the four
 * kinds `mergeModels` used to carry from the EXISTING model whatever a
 * reviewer accepted (`docs/specs/pair-coverage-floors.spec.md`,
 * barwise-985). The convention was unanimous, correct, articulate in
 * comments, and unenforced, so the one file that missed it missed it
 * silently.
 *
 * That is the gap this file closes, and it is the same shape as the
 * defects the convention exists to prevent: a rule everyone follows is
 * indistinguishable from a rule nothing checks, right up until one
 * place does not follow it (`docs/specs/test-quality.spec.md` WS1).
 *
 * Two markers, because either alone is easy to satisfy without meaning
 * it. The `describe` says a coverage block was written; `fc.sample`
 * says it draws from the same generator the laws draw from, rather
 * than asserting over fixtures that cannot speak to what the laws saw.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/** Every law file beside this one, by name. */
const lawFiles = readdirSync(here)
  .filter((name) => name.endsWith(".law.test.ts"))
  .sort();

const sourceOf = (name: string): string => readFileSync(join(here, name), "utf-8");

/** A `describe("coverage: ...")`, tolerant of how the call is wrapped. */
const COVERAGE_DESCRIBE = /describe\(\s*"coverage:/;

describe("convention: every law file declares the premises its laws rest on", () => {
  it("has law files to check", () => {
    // Guard the guard. Every assertion below is a filter over this
    // list, so an empty list makes all of them pass -- and a check
    // that cannot fail reads exactly like a check that is satisfied
    // (assertion-audit rule 1b; barwise-902 shipped that way). Five
    // today; the floor moves up when a sixth law earns a file.
    expect(
      lawFiles.length,
      `expected law files in ${here}, found ${lawFiles.length}`,
    ).toBeGreaterThanOrEqual(5);
  });

  it("gives every law file a coverage block", () => {
    const missing = lawFiles.filter((name) => !COVERAGE_DESCRIBE.test(sourceOf(name)));
    expect(
      missing,
      `no describe("coverage: ...") block in: ${missing.join(", ")}`
        + " -- a law whose generator never reaches the shape it asserts on"
        + " passes without evidence; count the shapes it needs",
    ).toEqual([]);
  });

  it("draws every coverage block from the generator the laws use", () => {
    const missing = lawFiles.filter((name) => !sourceOf(name).includes("fc.sample("));
    expect(
      missing,
      `no fc.sample(...) in: ${missing.join(", ")}`
        + " -- a coverage block over fixtures counts shapes the laws never saw;"
        + " draw from the same arbitrary at the same seed",
    ).toEqual([]);
  });
});
