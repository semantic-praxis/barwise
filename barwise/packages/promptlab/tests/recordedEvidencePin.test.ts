/**
 * The recorded round, rescored -- an integration pin over real payloads
 * (docs/specs/recorded-evidence-commands.spec.md).
 *
 * The unit tests cover the refusals on synthetic trees. This one runs
 * the command's actual job against the committed 2026-08-28 round, and
 * exists because that round's numbers are QUOTED as findings: the 2.8.0
 * appendix of the baseline doc reports 115 payloads, 40 fallen and none
 * risen, which for three appendices running was a hand-computed figure
 * nobody could re-derive.
 *
 * What is pinned here is the "after" side -- the per-arm means under the
 * current suite -- plus the coverage count. The fall/rise counts need the
 * PREVIOUS build to compute, so they cannot live in a test that runs at
 * one revision; reproducing them is `rescore --baseline`, and the
 * baseline doc records the result.
 *
 * A failure here means one of three things and they call for opposite
 * responses: the scorer changed on purpose (bump the suite and update
 * these numbers with the appendix), the scorer regressed (this is the
 * bug report), or the committed payloads were edited (which would forge
 * the record).
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSuitePath, loadSuite } from "../src/evalcase/loadSuite.js";
import { rescoreDirectory } from "../src/record/rescore.js";

const ROUND = join(import.meta.dirname, "../../../eval-payloads/20260828-1647");
const suite = loadSuite(defaultSuitePath());

// Per arm: payload count and mean, under suite 2.9.0. Every arm fell
// when must_validate left the rubric (barwise-902), and the SHAPE of
// the fall is the point: the weakest arm lost most (-0.0144) and the
// strongest least (-0.0017). A check that always passed was propping
// up the payloads with the most failures.
const EXPECTED: readonly (readonly [string, number, number])[] = [
  ["default-haiku-dev", 13, 0.907859],
  ["default-haiku-train", 18, 0.856735],
  ["default-sonnet-dev", 13, 0.847562],
  ["default-sonnet-train", 13, 0.940673],
  ["haiku45-2-dev", 11, 0.952047],
  ["haiku45-2-train", 16, 0.895506],
  ["sonnet5-3-dev", 14, 0.829137],
  ["sonnet5-3-train", 17, 0.891838],
];

describe.skipIf(!existsSync(ROUND))("the committed 2026-08-28 round, rescored", () => {
  const result = rescoreDirectory(ROUND, suite);

  it("covers every payload in the round", () => {
    // 115 is the number the 2.9.0 appendix quotes. A rescore that
    // silently covered fewer would still print a confident total.
    expect(result.payloads).toHaveLength(115);
    expect(result.suiteVersion).toBe(suite.version);
  });

  it.each(EXPECTED)("%s: %i payloads, mean %f", (arm, count, mean) => {
    const scores = result.payloads.filter((p) => p.arm === arm).map((p) => p.score);
    expect(scores).toHaveLength(count);
    expect(scores.reduce((a, b) => a + b, 0) / scores.length).toBeCloseTo(mean, 5);
  });
});
