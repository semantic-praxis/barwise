/**
 * `rescoreDirectory` and `diffRescores`
 * (docs/specs/recorded-evidence-commands.spec.md).
 *
 * The behaviour under test is mostly the REFUSALS. Both happy paths are
 * exercised end to end against the committed round in
 * `recordedEvidence.pin.test.ts`; what unit tests are for here is the
 * two ways this command could quietly report a number smaller than the
 * round it claims to cover.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultSuitePath, loadSuite } from "../src/evalcase/loadSuite.js";
import { diffRescores, rescoreDirectory, type RescoreResult } from "../src/record/rescore.js";

const suite = loadSuite(defaultSuitePath());
const answerKey = (caseId: string) =>
  join(import.meta.dirname, "fixtures/responses", `${caseId}.json`);

function treeWith(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "rescore-"));
  for (const [rel, content] of Object.entries(files)) {
    const slash = rel.lastIndexOf("/");
    if (slash !== -1) mkdirSync(join(dir, rel.slice(0, slash)), { recursive: true });
    writeFileSync(join(dir, rel), content);
  }
  return dir;
}

const KEY = (caseId: string) => readFileSync(answerKey(caseId), "utf8");

describe("rescoreDirectory", () => {
  it("scores payloads recursively and labels each by its directory", () => {
    const dir = treeWith({
      "armA/order-management-run1.json": KEY("order-management"),
      "armB/order-management-run1.json": KEY("order-management"),
    });
    const result = rescoreDirectory(dir, suite);
    expect(result.suiteVersion).toBe(suite.version);
    expect(result.payloads.map((p) => p.arm)).toEqual(["armA", "armB"]);
    expect(result.payloads[0]!.score).toBe(1);
  });

  it("is stable: two runs over an unchanged tree are identical", () => {
    const dir = treeWith({ "a/order-management-run1.json": KEY("order-management") });
    expect(JSON.stringify(rescoreDirectory(dir, suite)))
      .toBe(JSON.stringify(rescoreDirectory(dir, suite)));
  });

  it("ignores files that are not payloads", () => {
    const dir = treeWith({
      "a/order-management-run1.json": KEY("order-management"),
      "a/notes.md": "not a payload",
      "a.log": "nor this",
    });
    expect(rescoreDirectory(dir, suite).payloads).toHaveLength(1);
  });

  it("FAILS on a payload whose case the manifest does not declare", () => {
    // Skipping is how a rescore silently covers fewer files than the
    // round it names, and the count is the number people quote.
    const dir = treeWith({ "a/not-a-case-run1.json": "{}" });
    expect(() => rescoreDirectory(dir, suite)).toThrow(/not declared/);
  });
});

describe("diffRescores", () => {
  const base = (score: number): RescoreResult => ({
    suiteVersion: "1.0.0",
    payloads: [
      {
        file: "a/x-run1.json",
        arm: "a",
        caseId: "x",
        index: 0,
        score,
        rubricPassed: 1,
        rubricTotal: 1,
      },
    ],
  });

  it("classifies a fall, a rise and an unchanged payload", () => {
    expect(diffRescores(base(0.9), base(0.5)).fell[0]!.delta).toBeCloseTo(-0.4, 10);
    expect(diffRescores(base(0.5), base(0.9)).rose[0]!.delta).toBeCloseTo(0.4, 10);
    expect(diffRescores(base(0.5), base(0.5)).unchanged).toBe(1);
  });

  it("carries both suite versions, since crossing them is the point", () => {
    const before = { ...base(0.5), suiteVersion: "2.7.0" };
    const after = { ...base(0.5), suiteVersion: "2.8.0" };
    const diff = diffRescores(before, after);
    expect([diff.beforeVersion, diff.afterVersion]).toEqual(["2.7.0", "2.8.0"]);
  });

  it("REFUSES two rescores covering different payloads", () => {
    const before = base(0.5);
    const after: RescoreResult = {
      ...base(0.5),
      payloads: [
        ...base(0.5).payloads,
        {
          file: "a/y-run1.json",
          arm: "a",
          caseId: "y",
          index: 0,
          score: 1,
          rubricPassed: 1,
          rubricTotal: 1,
        },
      ],
    };
    expect(() => diffRescores(before, after)).toThrow(/different payloads/);
  });
});
