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
  repeat: 2,
  cases: [
    { caseId: "a", runs: [], mean: 0.9, worst: 0.8, samples: 2, failures: 0 },
    { caseId: "b", runs: [], mean: 1, worst: 1, samples: 2, failures: 0 },
  ],
  mean: 0.95,
  worst: 0.8,
  failures: 0,
  complete: true,
};

/** The same run, with one call the provider never answered. */
const incomplete: SuiteReport = {
  ...report,
  cases: [
    { caseId: "a", runs: [], mean: 0.9, worst: 0.9, samples: 1, failures: 1 },
    { caseId: "b", runs: [], mean: 1, worst: 1, samples: 2, failures: 0 },
  ],
  failures: 1,
  complete: false,
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
      repeat: 2,
      mean: 0.95,
      worst: 0.8,
      cases: [
        { caseId: "a", mean: 0.9, worst: 0.8, samples: 2 },
        { caseId: "b", mean: 1, worst: 1, samples: 2 },
      ],
    });
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
