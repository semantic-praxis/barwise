/**
 * The output-token derivation.
 *
 * Pinned against the real eval fixtures rather than round numbers,
 * because the constant this module exists to carry was calibrated from
 * exactly those files. A change to the ratio that quietly re-starves
 * the dev split is the failure this file is here to catch, and it is
 * invisible to any test written against made-up sizes.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKEN_CAP,
  suggestMaxTokens,
} from "../src/budget.js";

/** Sizes of the suite's transcripts, in bytes, as of the calibration. */
const SEED_LARGEST = 1589; // clinic-appointments
const DEV_SMALLEST = 13072; // incident-response
const DEV_LARGEST = 17171; // vendor-onboarding

describe("suggestMaxTokens", () => {
  it("leaves every seed case at the provider default", () => {
    // The whole seed suite fit in 8,192 and its recorded history is
    // built on that. If this ever returns more, every historical row
    // stops being comparable to a new one.
    expect(suggestMaxTokens("x".repeat(SEED_LARGEST))).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("clears the default for every dev-split transcript", () => {
    // The bug, stated as a test: at 8,192 these three scored 0.000,
    // 0.000 and 0.133 and nothing said why.
    for (const size of [DEV_SMALLEST, 14538, DEV_LARGEST]) {
      expect(suggestMaxTokens("x".repeat(size))).toBeGreaterThan(DEFAULT_MAX_OUTPUT_TOKENS);
    }
  });

  it("keeps the largest transcript in the suite under the cap", () => {
    // A cap below the biggest real case would re-create the bug while
    // looking like a safety measure.
    const derived = suggestMaxTokens("x".repeat(DEV_LARGEST));
    expect(derived).toBeLessThan(MAX_OUTPUT_TOKEN_CAP);
    expect(derived).toBeGreaterThan(40_000);
  });

  it("caps a pathological input rather than asking for the impossible", () => {
    expect(suggestMaxTokens("x".repeat(10_000_000))).toBe(MAX_OUTPUT_TOKEN_CAP);
  });

  it("never returns less than the floor, however short the transcript", () => {
    expect(suggestMaxTokens("")).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    expect(suggestMaxTokens("hello")).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
  });

  it("honours a caller's own floor, for a client built with a larger default", () => {
    expect(suggestMaxTokens("hello", { floor: 20_000 })).toBe(20_000);
  });

  it("lets the floor win over a lower cap", () => {
    // A caller that configured a large client default meant it; the cap
    // exists to bound a derivation, not to override a declaration.
    expect(suggestMaxTokens("x".repeat(DEV_LARGEST), { floor: 20_000, cap: 10_000 }))
      .toBe(20_000);
  });

  it("grows with the transcript, monotonically", () => {
    const sizes = [2_000, 5_000, 10_000, 20_000];
    const derived = sizes.map((s) => suggestMaxTokens("x".repeat(s)));
    for (let i = 1; i < derived.length; i++) {
      expect(derived[i]!).toBeGreaterThanOrEqual(derived[i - 1]!);
    }
  });

  it("returns a whole number, which is all a provider will accept", () => {
    expect(Number.isInteger(suggestMaxTokens("x".repeat(9_997)))).toBe(true);
  });
});
