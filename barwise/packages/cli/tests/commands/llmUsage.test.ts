/**
 * The report over the call log
 * (docs/specs/llm-call-observability.spec.md workstream 3).
 *
 * Workstream 1 built the record, workstream 2 the sink, and until this
 * the log accumulated with nothing reading it -- so task #2, the
 * model-tier economics question, stayed unanswerable while the data to
 * answer it piled up on disk.
 *
 * The tests that earn their keep are the tolerance ones. A log is
 * append-only, holds three record kinds, and can end mid-line when a
 * process dies; a reader that choked on any of that would lose the
 * operator ten thousand good rows to one bad one.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cli = resolve(__dirname, "../../dist/index.js");

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "barwise-usage-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function run(args: string[]): string {
  return execFileSync("node", [cli, "llm-usage", ...args], {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, BARWISE_CALL_LOG: "" },
  });
}

const CALLS = [
  {
    startedAt: "t1",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    modelUsed: "claude-haiku-4-5",
    promptTokens: 1000,
    completionTokens: 5000,
    latencyMs: 20000,
    ok: true,
  },
  {
    startedAt: "t2",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    modelUsed: "claude-haiku-4-5",
    promptTokens: 1000,
    completionTokens: 5000,
    latencyMs: 40000,
    ok: true,
  },
  {
    startedAt: "t3",
    provider: "anthropic",
    model: "claude-haiku-4-5",
    ok: false,
    errorKind: "rate_limit",
  },
];

function writeLog(rows: readonly unknown[], extra = ""): string {
  const path = join(tmp, "log.jsonl");
  writeFileSync(path, rows.map((r) => JSON.stringify(r)).join("\n") + "\n" + extra);
  return path;
}

describe("barwise llm-usage", () => {
  it("groups by model with tokens, failures, and percentiles", () => {
    const out = run(["--log", writeLog(CALLS), "--format", "json"]);
    const { models } = JSON.parse(out) as {
      models: Array<Record<string, unknown>>;
    };

    expect(models).toHaveLength(1);
    expect(models[0]).toMatchObject({
      model: "claude-haiku-4-5",
      calls: 3,
      failures: 1,
      promptTokens: 2000,
      completionTokens: 10000,
      errorKinds: { rate_limit: 1 },
    });
  });

  it("reports a latency tail, not just an average", () => {
    // A mean hides the tail, and the tail is what a timeout is set
    // against. Nearest-rank on two samples puts the median at the lower
    // and p95 at the upper.
    const { models } = JSON.parse(run(["--log", writeLog(CALLS), "--format", "json"])) as {
      models: Array<{ medianLatencyMs: number; p95LatencyMs: number; }>;
    };

    expect(models[0]!.medianLatencyMs).toBe(20000);
    expect(models[0]!.p95LatencyMs).toBe(40000);
  });

  it("skips records that are not calls, and a corrupt trailing line", () => {
    // One file carries call, extraction and validation records, and an
    // append-only log can end mid-write. Neither may cost the report.
    const path = writeLog(
      [
        ...CALLS,
        {
          startedAt: "t4",
          source: "validate:model",
          errors: 0,
          warnings: 2,
          errorsByRule: {},
          warningsByRule: {},
        },
        { startedAt: "t5", correctionsByCategory: { arity_mismatch: 1 }, corrections: 1 },
      ],
      '{"startedAt":"t6","prov',
    );
    const { models } = JSON.parse(run(["--log", path, "--format", "json"])) as {
      models: Array<{ calls: number; }>;
    };

    expect(models).toHaveLength(1);
    expect(models[0]!.calls).toBe(3);
  });

  it("computes cost only from supplied rates", () => {
    const rates = join(tmp, "rates.json");
    writeFileSync(rates, JSON.stringify({ "claude-haiku-4-5": { input: 1, output: 5 } }));

    const { models } = JSON.parse(
      run(["--log", writeLog(CALLS), "--rates", rates, "--format", "json"]),
    ) as { models: Array<{ cost: number; }>; };

    // 2000/1e6 * 1 + 10000/1e6 * 5
    expect(models[0]!.cost).toBeCloseTo(0.052, 6);
  });

  it("omits cost entirely when no rates are given", () => {
    // No prices ship with the repo: a stale rate produces a
    // confidently wrong number, which is worse than none.
    const { models } = JSON.parse(run(["--log", writeLog(CALLS), "--format", "json"])) as {
      models: Array<Record<string, unknown>>;
    };

    expect("cost" in models[0]!).toBe(false);
  });

  it("says so rather than printing an empty table when nothing is recorded", () => {
    const out = execFileSync("node", [cli, "llm-usage"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, BARWISE_CALL_LOG: "" },
    });

    expect(out).toBe("");
  });

  it("falls back to the requested model when the provider named none", () => {
    // Copilot cannot name its model before the call, and a failed call
    // never reports one. A row saying a call happened at all is still
    // worth more than a gap.
    const { models } = JSON.parse(
      run([
        "--log",
        writeLog([{ startedAt: "t", provider: "copilot", ok: true, latencyMs: 100 }]),
        "--format",
        "json",
      ]),
    ) as { models: Array<{ model: string; }>; };

    expect(models[0]!.model).toContain("copilot");
  });
});
