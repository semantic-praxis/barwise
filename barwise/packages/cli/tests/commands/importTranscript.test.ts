/**
 * Tests for `barwise import transcript` beyond argument validation
 * (covered in tests/commands/import.test.ts): the extraction pipeline,
 * the non-interactive merge-into-existing-output path, --trail,
 * --alternatives, --samples, and the observability sink.
 *
 * `createLlmClient`/`processTranscript`/`sampleTranscript` are mocked
 * per the `review.test.ts` convention (no test in this repo makes a
 * real LLM call); `diffModels`/`mergeAndValidate` are mocked too so the
 * merge branches (accept/reject, valid/invalid, merge failure) can be
 * driven directly instead of reverse-engineering real model diffs that
 * happen to trigger each one.
 */
import { OrmModel } from "@barwise/core";
import type { ModelDelta, ModelDiffResult } from "@barwise/core/diff";
import type { DraftModelResult } from "@barwise/llm";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let diffResult: ModelDiffResult = { hasChanges: false, synonymCandidates: [], deltas: [] };
let mergeResult: {
  model: OrmModel | null;
  diagnostics: { severity: string; message: string; }[];
  isValid: boolean;
} = {
  model: null,
  diagnostics: [],
  isValid: true,
};

vi.mock("@barwise/core/diff", async () => {
  const actual = await vi.importActual<typeof import("@barwise/core/diff")>("@barwise/core/diff");
  return {
    ...actual,
    diffModels: vi.fn(() => diffResult),
    mergeAndValidate: vi.fn(() => mergeResult),
  };
});

let draftResult: DraftModelResult = makeDraftResult();
let sampledResult:
  | (DraftModelResult & {
    agreement: { stable: number; disagreements: unknown[]; };
    samples: { index: number; status: "ok" | "failed"; }[];
  })
  | undefined;

vi.mock("@barwise/llm", async () => {
  const actual = await vi.importActual<typeof import("@barwise/llm")>("@barwise/llm");
  return {
    ...actual,
    createLlmClient: vi.fn(() => ({
      provider: "test",
      model: "test-model",
      complete: vi.fn(() => Promise.resolve({ content: "{}" })),
    })),
    processTranscript: vi.fn(() => Promise.resolve(draftResult)),
    sampleTranscript: vi.fn(() => Promise.resolve(sampledResult)),
    buildReasoningTrail: vi.fn(() => ({ steps: [] })),
  };
});

const { runCli } = await import("../workspace/run.js");

function makeDraftResult(overrides: Partial<DraftModelResult> = {}): DraftModelResult {
  const model = overrides.model ?? new OrmModel({ name: "Extracted" });
  return {
    model,
    objectTypeProvenance: [],
    factTypeProvenance: [],
    subtypeProvenance: [],
    constraintProvenance: [],
    objectificationProvenance: [],
    ambiguities: [],
    warnings: [],
    ...overrides,
  };
}

function objectTypeDelta(kind: ModelDelta["kind"], name: string): ModelDelta {
  return { kind, elementType: "object_type", name, changeDescriptions: [], breakingLevel: "safe" };
}

let dir: string;
let transcriptFile: string;
const originalCallLog = process.env["BARWISE_CALL_LOG"];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "barwise-import-transcript-test-"));
  transcriptFile = join(dir, "t.md");
  writeFileSync(transcriptFile, "Facilitator: Customers place orders.\n");
  diffResult = { hasChanges: false, synonymCandidates: [], deltas: [] };
  mergeResult = { model: null, diagnostics: [], isValid: true };
  draftResult = makeDraftResult();
  sampledResult = undefined;
  delete process.env["BARWISE_CALL_LOG"];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalCallLog === undefined) delete process.env["BARWISE_CALL_LOG"];
  else process.env["BARWISE_CALL_LOG"] = originalCallLog;
});

describe("barwise import transcript (basic extraction)", () => {
  it("extracts to stdout with no --output, --samples, or observability sink", async () => {
    const model = new OrmModel({ name: "Extracted" });
    model.addObjectType({ name: "Customer", kind: "entity", referenceMode: "customer_id" });
    draftResult = makeDraftResult({ model, warnings: ["a warning"], ambiguities: [] });

    const result = await runCli(["import", "transcript", transcriptFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("orm_version");
    expect(result.stderr).toContain("Extracting ORM model from transcript...\n");
    expect(result.stderr).toContain("1 warning(s).");
  });

  it("records to the observability sink when BARWISE_CALL_LOG is set", async () => {
    const logPath = join(dir, "calls.jsonl");
    process.env["BARWISE_CALL_LOG"] = logPath;

    const result = await runCli(["import", "transcript", transcriptFile]);
    expect(result.exitCode).toBe(0);
  });

  it("reports ambiguities and passes --name through as the extraction's modelName", async () => {
    draftResult = makeDraftResult({ ambiguities: [{ description: "x", source_references: [] }] });
    const { processTranscript } = await import("@barwise/llm");

    const result = await runCli(["import", "transcript", transcriptFile, "--name", "custom"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("1 ambiguity(ies) detected.");
    expect(processTranscript).toHaveBeenCalledWith(
      expect.any(String),
      expect.anything(),
      expect.objectContaining({ modelName: "custom" }),
    );
  });

  it("reports the model used when the provider names one", async () => {
    draftResult = makeDraftResult({ modelUsed: "claude-x" });
    const result = await runCli(["import", "transcript", transcriptFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("(model: claude-x)");
  });

  it("skips TODO/NOTE annotation with --no-annotate", async () => {
    const result = await runCli(["import", "transcript", transcriptFile, "--no-annotate"]);
    expect(result.exitCode).toBe(0);
  });

  it("renders alternative framings with --alternatives", async () => {
    const primary = new OrmModel({ name: "Primary" });
    const alt = new OrmModel({ name: "Alt" });
    const { diffModels } = await import("@barwise/core/diff");
    draftResult = makeDraftResult({
      model: primary,
      alternatives: [
        {
          rationale: "Because",
          ambiguityDescription: "Fork",
          model: alt,
          diff: (diffModels as unknown as () => ModelDiffResult)(),
        },
      ],
    });

    const result = await runCli(["import", "transcript", transcriptFile, "--alternatives"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Alternative framings:");
  });
});

describe("barwise import transcript --samples", () => {
  it("runs the multi-sample path and reports agreement with disagreements", async () => {
    const model = new OrmModel({ name: "Sampled" });
    sampledResult = {
      ...makeDraftResult({ model }),
      agreement: { stable: 2, disagreements: [{}] },
      samples: [
        { index: 0, status: "ok" },
        { index: 1, status: "ok" },
        { index: 2, status: "failed" },
      ],
    };

    const result = await runCli(["import", "transcript", transcriptFile, "--samples", "3"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Extracting ORM model from transcript (3 samples)...");
    expect(result.stderr).toContain(
      "Agreement over 2 sample(s): 2 stable element(s), 1 disagreement(s) (reported above as ambiguities).",
    );
  });

  it("reports zero disagreements without the parenthetical note", async () => {
    sampledResult = {
      ...makeDraftResult(),
      agreement: { stable: 5, disagreements: [] },
      samples: [{ index: 0, status: "ok" }],
    };

    const result = await runCli(["import", "transcript", transcriptFile, "--samples", "2"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("0 disagreement(s).\n");
  });
});

describe("barwise import transcript --trail", () => {
  it("writes a sidecar next to --output ending in .orm.yaml", async () => {
    const outFile = join(dir, "model.orm.yaml");
    const result = await runCli([
      "import",
      "transcript",
      transcriptFile,
      "--output",
      outFile,
      "--trail",
    ]);
    expect(result.exitCode).toBe(0);
    const trailPath = join(dir, "model.trail.json");
    expect(existsSync(trailPath)).toBe(true);
    expect(result.stderr).toContain(`Reasoning trail written to ${trailPath}.`);
  });

  it("appends .trail.json when --output does not end in .orm.yaml", async () => {
    const outFile = join(dir, "model.yaml");
    const result = await runCli([
      "import",
      "transcript",
      transcriptFile,
      "--output",
      outFile,
      "--trail",
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(`${outFile}.trail.json`)).toBe(true);
  });

  it("notes that --trail without --output writes nothing", async () => {
    const result = await runCli(["import", "transcript", transcriptFile, "--trail"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Note: --trail requires --output; no trail written.");
  });
});

describe("barwise import transcript (merge into existing --output)", () => {
  it("reports no changes and returns early when the diff is empty", async () => {
    const outFile = join(dir, "existing.orm.yaml");
    writeFileSync(outFile, 'orm_version: "1.1"\nmodel:\n  name: existing\n');
    diffResult = { hasChanges: false, synonymCandidates: [], deltas: [] };

    const before = readFileSync(outFile, "utf8");
    const result = await runCli(["import", "transcript", transcriptFile, "--output", outFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("No changes detected -- existing model is up to date.");
    expect(readFileSync(outFile, "utf8")).toBe(before);
  });

  it("accepts added/modified deltas, rejects removed, and writes a valid merge", async () => {
    const outFile = join(dir, "existing.orm.yaml");
    writeFileSync(outFile, 'orm_version: "1.1"\nmodel:\n  name: existing\n');
    diffResult = {
      hasChanges: true,
      synonymCandidates: [],
      deltas: [
        objectTypeDelta("added", "NewThing"),
        objectTypeDelta("modified", "Changed"),
        objectTypeDelta("removed", "Gone"),
      ],
    };
    const mergedModel = new OrmModel({ name: "Merged" });
    mergeResult = { model: mergedModel, diagnostics: [], isValid: true };

    const result = await runCli(["import", "transcript", transcriptFile, "--output", outFile]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(outFile, "utf8")).toContain("name: Merged");
    expect(result.stderr).not.toContain("Warning:");
  });

  it("warns when the merged model has validation issues", async () => {
    const outFile = join(dir, "existing.orm.yaml");
    writeFileSync(outFile, 'orm_version: "1.1"\nmodel:\n  name: existing\n');
    diffResult = {
      hasChanges: true,
      synonymCandidates: [],
      deltas: [objectTypeDelta("added", "X")],
    };
    mergeResult = {
      model: new OrmModel({ name: "Merged" }),
      diagnostics: [{ severity: "error", message: "bad" }],
      isValid: false,
    };

    const result = await runCli(["import", "transcript", transcriptFile, "--output", outFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Warning: Merged model has 1 validation issue(s).");
  });

  it("falls back to the extracted model when the merge fails", async () => {
    const outFile = join(dir, "existing.orm.yaml");
    writeFileSync(outFile, 'orm_version: "1.1"\nmodel:\n  name: existing\n');
    diffResult = {
      hasChanges: true,
      synonymCandidates: [],
      deltas: [objectTypeDelta("added", "X")],
    };
    mergeResult = { model: null, diagnostics: [], isValid: false };

    const result = await runCli(["import", "transcript", transcriptFile, "--output", outFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Warning: Merge failed, using extracted model directly.");
  });

  it("overwrites silently when the existing --output file is not a valid model", async () => {
    const outFile = join(dir, "existing.orm.yaml");
    writeFileSync(outFile, "not: valid: yaml: at: all: :\n");

    const result = await runCli(["import", "transcript", transcriptFile, "--output", outFile]);
    expect(result.exitCode).toBe(0);
  });
});
