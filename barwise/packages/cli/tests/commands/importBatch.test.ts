/**
 * Tests for `barwise import batch` beyond argument validation (covered
 * in tests/commands/import.test.ts): the per-cell extraction loop,
 * --output-dir, --no-annotate, the observability sink, and the summary
 * table's success/failure rendering.
 *
 * `createLlmClient`/`processTranscript` are mocked per the
 * `review.test.ts` convention -- no test in this repo makes a real LLM
 * call.
 */
import { OrmModel } from "@barwise/core";
import type { DraftModelResult } from "@barwise/llm";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@barwise/llm", async () => {
  const actual = await vi.importActual<typeof import("@barwise/llm")>("@barwise/llm");
  return {
    ...actual,
    createLlmClient: vi.fn((options?: { model?: string; }) => ({
      provider: "test",
      model: options?.model,
      complete: vi.fn(() => Promise.resolve({ content: "{}" })),
    })),
    processTranscript: vi.fn(
      (_transcript: string, client: { model?: string; }, opts: { modelName: string; }) => {
        if (client.model === "should-fail") {
          return Promise.reject(new Error("boom"));
        }
        const model = new OrmModel({ name: opts.modelName });
        model.addObjectType({ name: "Thing", kind: "entity", referenceMode: "thing_id" });
        const draft: DraftModelResult = {
          model,
          objectTypeProvenance: [],
          factTypeProvenance: [],
          subtypeProvenance: [],
          constraintProvenance: [
            { description: "unique id", confidence: "high", sourceReferences: [], applied: true },
            {
              description: "skipped one",
              confidence: "low",
              sourceReferences: [],
              applied: false,
              skipReason: "ambiguous",
            },
          ],
          objectificationProvenance: [],
          ambiguities: [],
          warnings: [],
        };
        return Promise.resolve(draft);
      },
    ),
  };
});

const { runCli } = await import("../workspace/run.js");

let dir: string;
const originalCallLog = process.env["BARWISE_CALL_LOG"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "barwise-import-batch-test-"));
  delete process.env["BARWISE_CALL_LOG"];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalCallLog === undefined) delete process.env["BARWISE_CALL_LOG"];
  else process.env["BARWISE_CALL_LOG"] = originalCallLog;
});

describe("barwise import batch (mixed success/failure, --output-dir, sink)", () => {
  it("writes successes to --output-dir, records failures, and reports the mixed summary", async () => {
    writeFileSync(join(dir, "t.md"), "Facilitator: hello.\n");
    const outDir = join(dir, "out");
    mkdirSync(outDir, { recursive: true });
    process.env["BARWISE_CALL_LOG"] = join(dir, "calls.jsonl");

    const result = await runCli([
      "import",
      "batch",
      dir,
      "--model",
      "should-fail",
      "should-succeed",
      "--output-dir",
      outDir,
    ]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("FAILED: boom");
    expect(result.stderr).toContain("1 of 2 combination(s) failed.");
    expect(existsSync(join(outDir, "t-should-succeed.orm.yaml"))).toBe(true);
    expect(readFileSync(join(outDir, "t-should-succeed.orm.yaml"), "utf8")).toContain("Thing");
  });
});

describe("barwise import batch (all succeed, --no-annotate, default output dir)", () => {
  it("writes to the input directory by default and reports full success", async () => {
    writeFileSync(join(dir, "t.md"), "Facilitator: hello.\n");

    const result = await runCli([
      "import",
      "batch",
      dir,
      "--model",
      "should-succeed",
      "--no-annotate",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("All 1 combination(s) succeeded.");
    expect(existsSync(join(dir, "t-should-succeed.orm.yaml"))).toBe(true);
  });
});
