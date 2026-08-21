/**
 * Separating collapse from quality
 * (eval-metric-readiness spec, workstream 1).
 *
 * The claim this workstream makes is a numeric one -- that splitting a
 * bimodal case at a floor makes the surviving population materially
 * tighter -- so the test asserts it on the real recorded samples rather
 * than on invented ones. If the split stopped buying sensitivity, this
 * fails and the workstream's reason for existing is gone.
 */
import { describe, expect, it } from "vitest";
import { sampleSd, splitAtFloor } from "../src/stats/dispersion.js";

/**
 * `university-enrollment` under Haiku 4.5 on the default artifact,
 * 2026-08-21 (branch optimization-evals-3): mean 0.280, worst 0.000,
 * sd 0.383. Two collapses and three usable runs, averaged into a number
 * that describes neither.
 */
const UNIVERSITY_ENROLLMENT_HAIKU = [0.0, 0.0, 0.7, 0.7, 0.0] as const;

describe("splitAtFloor", () => {
  it("counts what fell below and keeps what did not", () => {
    const { collapses, quality } = splitAtFloor([0.0, 0.95, 0.2, 1.0], 0.3);
    expect(collapses).toBe(2);
    expect(quality).toEqual([0.95, 1.0]);
  });

  it("treats the floor itself as surviving", () => {
    // A floor is the lowest acceptable score, not the highest
    // unacceptable one. Off by one here silently reclassifies samples.
    expect(splitAtFloor([0.3], 0.3)).toEqual({ collapses: 0, quality: [0.3] });
  });

  it("reports an empty quality set rather than a zero when all collapsed", () => {
    // The distinction the whole module turns on: a configuration that
    // never produced a usable model has no quality to report, which is
    // not the same as modelling badly.
    const { collapses, quality } = splitAtFloor([0.0, 0.1], 0.3);
    expect(collapses).toBe(2);
    expect(quality).toEqual([]);
  });

  it("collapses nothing when the floor is zero", () => {
    expect(splitAtFloor([0.0, 0.5], 0).collapses).toBe(0);
  });
});

describe("the sensitivity the split buys", () => {
  it("tightens the surviving population on the recorded bimodal case", () => {
    const all = UNIVERSITY_ENROLLMENT_HAIKU;
    const { collapses, quality } = splitAtFloor(all, 0.3);

    expect(collapses).toBe(3);
    const sdAll = sampleSd(all)!;
    const sdQuality = sampleSd(quality)!;

    // The recorded case: averaging the two states gives a spread of
    // ~0.38; the surviving runs agree with each other exactly.
    expect(sdAll).toBeGreaterThan(0.3);
    expect(sdQuality).toBe(0);
    expect(sdQuality).toBeLessThan(sdAll);
  });

  it("leaves a unimodal case essentially unchanged", () => {
    // The split must not flatter a case that was never bimodal --
    // otherwise it would report an improvement everywhere and mean
    // nothing anywhere.
    const steady = [0.94, 0.96, 0.95, 0.96, 0.94];
    const { collapses, quality } = splitAtFloor(steady, 0.3);
    expect(collapses).toBe(0);
    expect(sampleSd(quality)).toBeCloseTo(sampleSd(steady)!, 12);
  });
});
