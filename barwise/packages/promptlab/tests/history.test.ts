/**
 * Tests for the JSONL score history: append/read round-trip, the
 * missing-file default, and the report-to-entry mapping.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SuiteReport } from "../src/index.js";
import {
  appendHistory,
  appendRunHistory,
  historyPathFor,
  IncompleteRunError,
  readHistory,
  toHistoryEntry,
} from "../src/index.js";

const report: SuiteReport = {
  suiteVersion: "1.0.0",
  artifactVersion: "2.0.0",
  promptHash: "abc123def456",
  repeat: 2,
  cases: [
    { caseId: "a", runs: [], mean: 0.9, worst: 0.8, samples: 2, failures: 0, sd: 0.1 },
    { caseId: "b", runs: [], mean: 1, worst: 1, samples: 2, failures: 0, sd: 0 },
  ],
  mean: 0.95,
  worst: 0.8,
  failures: 0,
  complete: true,
  // sqrt((0.01/2) + 0) / 2 = 0.0353553
  dispersion: {
    standardError: 0.0353553,
    lowerBound: false,
    resolvableDifference: 0.098,
    dominantCase: { caseId: "a", share: 1 },
  },
};

/** The same run, with one call the provider never answered. */
const incomplete: SuiteReport = {
  ...report,
  cases: [
    { caseId: "a", runs: [], mean: 0.9, worst: 0.9, samples: 1, failures: 1 },
    { caseId: "b", runs: [], mean: 1, worst: 1, samples: 2, failures: 0, sd: 0 },
  ],
  failures: 1,
  complete: false,
  // Case "a" lost a run and has no spread of its own, so the interval
  // that survives is a floor.
  dispersion: { standardError: 0, lowerBound: true, resolvableDifference: 0 },
};

describe("history", () => {
  it("derives the history path from the suite manifest", () => {
    expect(historyPathFor("/x/evals/suite.yaml")).toBe(join("/x/evals", "history.jsonl"));
  });

  it("maps a report to an entry, dropping run detail", () => {
    const entry = toHistoryEntry(report, "2026-08-08T00:00:00Z", {
      provider: "anthropic",
      model: "claude-sonnet-5",
    });
    expect(entry).toEqual({
      date: "2026-08-08T00:00:00Z",
      suiteVersion: "1.0.0",
      artifactVersion: "2.0.0",
      provider: "anthropic",
      model: "claude-sonnet-5",
      promptHash: "abc123def456",
      repeat: 2,
      mean: 0.95,
      worst: 0.8,
      standardError: 0.0353553,
      cases: [
        { caseId: "a", mean: 0.9, worst: 0.8, samples: 2, sd: 0.1 },
        { caseId: "b", mean: 1, worst: 1, samples: 2, sd: 0 },
      ],
    });
  });

  it("carries the thinking budget the caller supplies, and omits it otherwise", () => {
    // Recorded because a budget changes scores without changing
    // promptHash, provider or model -- two rows differing only in it
    // measured different configurations
    // (docs/specs/thinking-budget-dimension.spec.md).
    const withBudget = toHistoryEntry(report, "2026-08-29T00:00:00Z", {
      thinkingBudget: 4096,
    });
    expect(withBudget.thinkingBudget).toBe(4096);

    const without = toHistoryEntry(report, "2026-08-29T00:00:00Z");
    expect("thinkingBudget" in without).toBe(false);
  });

  it("carries the build provenance the caller supplies, and omits it otherwise", () => {
    // Same seam as the date: this package computes the prompt hash from
    // bytes it rendered, and takes everything requiring I/O from the
    // caller.
    const withBuild = toHistoryEntry(report, "2026-08-21T00:00:00Z", {
      build: { version: "1.7.0", commit: "deadbeef", dirty: false },
    });
    expect(withBuild.build).toEqual({ version: "1.7.0", commit: "deadbeef", dirty: false });
    expect(withBuild.promptHash).toBe("abc123def456");

    const without = toHistoryEntry(report, "2026-08-21T00:00:00Z");
    expect("build" in without).toBe(false);
    // The hash is not the caller's to supply, so it survives regardless.
    expect(without.promptHash).toBe("abc123def456");
  });

  it("round-trips provenance through the JSONL file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "barwise-history-")), "history.jsonl");
    appendHistory(
      path,
      toHistoryEntry(report, "2026-08-21T00:00:00Z", {
        build: { version: "1.7.0", commit: "deadbeef", dirty: true },
      }),
    );
    const [back] = readHistory(path);
    expect(back!.build?.commit).toBe("deadbeef");
    expect(back!.build?.dirty).toBe(true);
    expect(back!.promptHash).toBe("abc123def456");
  });

  it("reads a row written before provenance existed", () => {
    // Backward compatibility is the whole reason these fields are
    // optional: an old row is not broken, it just knows less.
    const path = join(mkdtempSync(join(tmpdir(), "barwise-history-")), "history.jsonl");
    appendHistory(path, {
      date: "2026-08-09T00:00:00Z",
      suiteVersion: "1.0.0",
      artifactVersion: "1.0.0",
      repeat: 1,
      mean: 0.76,
      worst: 0.3,
      cases: [],
    });
    const [back] = readHistory(path);
    expect(back!.promptHash).toBeUndefined();
    expect(back!.build).toBeUndefined();
    expect(back!.mean).toBe(0.76);
  });

  it("records no standard error when the run could not resolve one", () => {
    // A row without an error bar is the truth about a single-sample
    // run. Writing 0 instead would make it indistinguishable from a
    // perfectly stable one when someone reads the file back later.
    const unresolved: SuiteReport = {
      ...report,
      cases: [{ caseId: "a", runs: [], mean: 0.9, worst: 0.9, samples: 1, failures: 0 }],
      dispersion: { lowerBound: true },
    };
    const entry = toHistoryEntry(unresolved, "2026-08-08T00:00:00Z");
    expect(entry.standardError).toBeUndefined();
    expect("standardError" in entry).toBe(false);
    expect(entry.cases[0]!.sd).toBeUndefined();
  });

  it("appends and reads back entries in order", () => {
    const path = join(mkdtempSync(join(tmpdir(), "barwise-history-")), "history.jsonl");
    const first = toHistoryEntry(report, "2026-08-08T00:00:00Z");
    const second = toHistoryEntry({ ...report, mean: 0.5 }, "2026-08-09T00:00:00Z");
    appendHistory(path, first);
    appendHistory(path, second);
    const entries = readHistory(path);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.mean).toBe(0.95);
    expect(entries[1]!.mean).toBe(0.5);
    expect(entries[1]!.date).toBe("2026-08-09T00:00:00Z");
  });

  it("returns an empty history for a missing file", () => {
    expect(readHistory("/nonexistent/history.jsonl")).toEqual([]);
  });

  it("records a complete run through the guarded writer", () => {
    const path = join(mkdtempSync(join(tmpdir(), "barwise-history-")), "history.jsonl");
    const entry = toHistoryEntry(report, "2026-08-20T00:00:00Z");
    appendRunHistory(path, report, entry);
    expect(readHistory(path)).toHaveLength(1);
  });

  it("refuses to record a run the provider did not fully answer", () => {
    // Three junk rows reached the real history this way (barwise-806).
    const path = join(mkdtempSync(join(tmpdir(), "barwise-history-")), "history.jsonl");
    const entry = toHistoryEntry(incomplete, "2026-08-20T00:00:00Z");
    expect(() => appendRunHistory(path, incomplete, entry)).toThrow(IncompleteRunError);
    expect(() => appendRunHistory(path, incomplete, entry)).toThrow(/1 of 4 requested runs/);
    expect(readHistory(path)).toEqual([]);
  });

  it("records an incomplete run when the caller forces it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "barwise-history-")), "history.jsonl");
    const entry = toHistoryEntry(incomplete, "2026-08-20T00:00:00Z");
    appendRunHistory(path, incomplete, entry, { force: true });
    expect(readHistory(path)).toHaveLength(1);
  });

  it("carries per-case sample counts so a partial row is legible later", () => {
    const entry = toHistoryEntry(incomplete, "2026-08-20T00:00:00Z");
    expect(entry.cases.map((c) => c.samples)).toEqual([1, 2]);
    expect(entry.repeat).toBe(2);
  });
});

describe("token totals in a history row", () => {
  it("records the four counts, so cost stays reconstructable later", () => {
    // These do not bear on comparability -- caching is score-neutral.
    // They are here because cost is a longitudinal question and no
    // price table belongs in this package.
    const entry = toHistoryEntry(
      {
        suiteVersion: "1.0.0",
        artifactVersion: "1.0.0",
        promptHash: "abc",
        repeat: 2,
        cases: [{
          caseId: "c",
          runs: [
            { promptTokens: 100, outputTokens: 50 },
            { promptTokens: 120, outputTokens: 60 },
          ],
          mean: 1,
          worst: 1,
          samples: 2,
          failures: 0,
          truncations: 0,
        }],
        mean: 1,
        worst: 1,
        failures: 0,
        truncations: 0,
        complete: true,
        cache: { requested: true, readTokens: 900, writeTokens: 300 },
        dispersion: {},
      },
      "2026-08-22T00:00:00Z",
    );

    expect(entry.tokens).toEqual({
      prompt: 220,
      completion: 110,
      cacheRead: 900,
      cacheWrite: 300,
    });
  });

  it("omits the cache figures when no provider reported them", () => {
    // A row from a provider with no cache must not claim it read zero.
    const entry = toHistoryEntry(
      {
        suiteVersion: "1.0.0",
        artifactVersion: "1.0.0",
        promptHash: "abc",
        repeat: 1,
        cases: [{
          caseId: "c",
          runs: [{ promptTokens: 10, outputTokens: 5 }],
          mean: 1,
          worst: 1,
          samples: 1,
          failures: 0,
          truncations: 0,
        }],
        mean: 1,
        worst: 1,
        failures: 0,
        truncations: 0,
        complete: true,
        dispersion: {},
      },
      "2026-08-22T00:00:00Z",
    );

    expect(entry.tokens).toEqual({ prompt: 10, completion: 5 });
  });

  it("is absent entirely when no usage was reported at all", () => {
    const entry = toHistoryEntry(
      {
        suiteVersion: "1.0.0",
        artifactVersion: "1.0.0",
        promptHash: "abc",
        repeat: 1,
        cases: [{
          caseId: "c",
          runs: [{}],
          mean: 1,
          worst: 1,
          samples: 1,
          failures: 0,
          truncations: 0,
        }],
        mean: 1,
        worst: 1,
        failures: 0,
        truncations: 0,
        complete: true,
        dispersion: {},
      },
      "2026-08-22T00:00:00Z",
    );

    expect(entry.tokens).toBeUndefined();
  });
});
