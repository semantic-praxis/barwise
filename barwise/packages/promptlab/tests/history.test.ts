/**
 * Tests for the JSONL score history: append/read round-trip, the
 * missing-file default, and the report-to-entry mapping.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { SuiteReport } from "../src/index.js";
import { appendHistory, historyPathFor, readHistory, toHistoryEntry } from "../src/index.js";

const report: SuiteReport = {
  suiteVersion: "1.0.0",
  artifactVersion: "2.0.0",
  repeat: 2,
  cases: [
    { caseId: "a", runs: [], mean: 0.9, worst: 0.8 },
    { caseId: "b", runs: [], mean: 1, worst: 1 },
  ],
  mean: 0.95,
  worst: 0.8,
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
        { caseId: "a", mean: 0.9, worst: 0.8 },
        { caseId: "b", mean: 1, worst: 1 },
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
});
