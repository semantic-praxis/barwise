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
 *
 * Run through `runCli`, in process, like every other command test.
 * The first version drove the built binary through `execFileSync` and
 * all seven passed while covering nothing -- a subprocess is not
 * instrumented by the parent's coverage collector, so the file read
 * 11% and dragged the package under its threshold. Passing tests that
 * measure nothing are worse than no tests, because they also look
 * like reassurance.
 */
import { withCallLog } from "@barwise/llm";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

let tmp: string;
const SAVED = process.env["BARWISE_CALL_LOG"];

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "barwise-usage-"));
  // Off by default, so a test that means to exercise "not configured"
  // is not quietly reading the developer's own log.
  delete process.env["BARWISE_CALL_LOG"];
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  if (SAVED === undefined) delete process.env["BARWISE_CALL_LOG"];
  else process.env["BARWISE_CALL_LOG"] = SAVED;
});

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

async function usage(args: string[]): Promise<{ stdout: string; stderr: string; }> {
  const result = await runCli(["llm-usage", ...args]);
  return { stdout: result.stdout, stderr: result.stderr };
}

async function models(args: string[]): Promise<Array<Record<string, unknown>>> {
  const { stdout } = await usage([...args, "--format", "json"]);
  return (JSON.parse(stdout) as { models: Array<Record<string, unknown>>; }).models;
}

describe("barwise llm-usage", () => {
  it("reads a record the real emitter wrote, not just this file's fixtures", async () => {
    // Every other test here feeds hand-written rows, and the reader
    // deliberately declares its own row shape rather than importing
    // `LlmCallRecord` -- so the emitter and this report agree only by
    // convention, and a field renamed in @barwise/llm (with its own
    // in-package tests updated in the same change) would leave both
    // suites green while this command quietly reported zero tokens.
    // One record produced by `withCallLog` itself pins the
    // correspondence.
    const recorded: unknown[] = [];
    const client = withCallLog(
      {
        provider: "anthropic",
        model: "claude-haiku-4-5",
        async complete() {
          return {
            content: "{}",
            modelUsed: "claude-haiku-4-5",
            usage: { promptTokens: 700, completionTokens: 300 },
          };
        },
      },
      { record: (entry) => recorded.push(entry) },
      { now: () => "2026-08-25T00:00:00Z" },
    );
    await client.complete({ systemPrompt: "s", userMessage: "u" });

    const found = await models(["--log", writeLog(recorded)]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      model: "claude-haiku-4-5",
      calls: 1,
      failures: 0,
      promptTokens: 700,
      completionTokens: 300,
    });
  });

  it("groups by model with tokens and failures", async () => {
    const found = await models(["--log", writeLog(CALLS)]);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      model: "claude-haiku-4-5",
      calls: 3,
      failures: 1,
      promptTokens: 2000,
      completionTokens: 10000,
      errorKinds: { rate_limit: 1 },
    });
  });

  it("reports a latency tail, not just an average", async () => {
    // A mean hides the tail, and the tail is what a timeout is set
    // against. Nearest-rank on two samples puts the median at the lower
    // and p95 at the upper.
    const found = await models(["--log", writeLog(CALLS)]);

    expect(found[0]!["medianLatencyMs"]).toBe(20000);
    expect(found[0]!["p95LatencyMs"]).toBe(40000);
  });

  it("skips records that are not calls, and a corrupt trailing line", async () => {
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
    const found = await models(["--log", path]);

    expect(found).toHaveLength(1);
    expect(found[0]!["calls"]).toBe(3);
  });

  it("computes cost only from supplied rates", async () => {
    const rates = join(tmp, "rates.json");
    writeFileSync(rates, JSON.stringify({ "claude-haiku-4-5": { input: 1, output: 5 } }));

    const found = await models(["--log", writeLog(CALLS), "--rates", rates]);

    // 2000/1e6 * 1 + 10000/1e6 * 5
    expect(found[0]!["cost"]).toBeCloseTo(0.052, 6);
  });

  it("omits cost entirely when no rates are given", async () => {
    // No prices ship with the repo: a stale rate produces a
    // confidently wrong number, which is worse than none.
    const found = await models(["--log", writeLog(CALLS)]);

    expect("cost" in found[0]!).toBe(false);
  });

  it("renders text with the tail, the failures, and the cost note", async () => {
    const { stdout } = await usage(["--log", writeLog(CALLS)]);

    expect(stdout).toContain("claude-haiku-4-5");
    expect(stdout).toContain("1 failed");
    expect(stdout).toContain("rate_limit x1");
    expect(stdout).toContain("p95");
    expect(stdout).toContain("--rates");
  });

  it("says n/a rather than 0 ms when nothing reported a latency", async () => {
    // Copilot reports none, and "0 ms" would be a claim the log never
    // made -- the same distinction the dispersion module draws between
    // "no observations" and "zero".
    const { stdout } = await usage([
      "--log",
      writeLog([{ startedAt: "t", provider: "copilot", model: "gpt-4o", ok: true }]),
    ]);

    expect(stdout).toContain("n/a");
    expect(stdout).not.toContain("0 ms");
  });

  it("names the model that cannot be priced rather than omitting it", async () => {
    const rates = join(tmp, "rates.json");
    writeFileSync(rates, JSON.stringify({ "some-other-model": { input: 1, output: 5 } }));

    const { stdout } = await usage(["--log", writeLog(CALLS), "--rates", rates]);

    expect(stdout).toContain("no rate for this model");
  });

  it("says so rather than printing an empty table when recording is off", async () => {
    const { stdout, stderr } = await usage([]);

    expect(stdout).toBe("");
    expect(stderr).toContain("No call log configured");
  });

  it("says so when the log has not been written yet", async () => {
    process.env["BARWISE_CALL_LOG"] = join(tmp, "never-written.jsonl");
    const { stderr } = await usage([]);

    expect(stderr).toContain("written on the first recorded call");
  });

  it("reports an empty log as no calls rather than crashing", async () => {
    const { stdout } = await usage(["--log", writeLog([])]);

    expect(stdout).toContain("No calls recorded");
  });

  it("falls back to the requested model when the provider named none", async () => {
    // Copilot cannot name its model before the call, and a failed call
    // never reports one. A row saying a call happened at all is still
    // worth more than a gap.
    const found = await models([
      "--log",
      writeLog([{ startedAt: "t", provider: "copilot", ok: true, latencyMs: 100 }]),
    ]);

    expect(found[0]!["model"]).toContain("copilot");
  });

  it("reports a bad rates file as an error rather than a stack trace", async () => {
    const rates = join(tmp, "rates.json");
    writeFileSync(rates, "{ not json");

    const { stderr } = await usage(["--log", writeLog(CALLS), "--rates", rates]);

    expect(stderr).toContain("Error:");
  });
});

describe("llm-usage prompt provenance", () => {
  // Whether a window of calls is comparable at all: two hashes for one
  // model means the window spans a prompt change, and a mean across it
  // is a mean over two different things
  // (docs/specs/artifact-resolution-parity.spec.md, workstream 2).
  const withHashes = (hashes: readonly string[]) =>
    hashes.map((h, i) => ({
      startedAt: `t${i}`,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      modelUsed: "claude-haiku-4-5",
      ok: true,
      promptHash: h,
    }));

  it("names the distinct hashes when there are few", async () => {
    const log = writeLog(withHashes(["aaaaaaaaaaaa", "aaaaaaaaaaaa", "bbbbbbbbbbbb"]));
    const { stdout } = await usage(["--log", log]);

    expect(stdout).toContain("aaaaaaaaaaaa, bbbbbbbbbbbb");
  });

  it("counts them instead once the list stops being readable", async () => {
    const log = writeLog(
      withHashes(["aaaaaaaaaaaa", "bbbbbbbbbbbb", "cccccccccccc", "dddddddddddd"]),
    );
    const { stdout } = await usage(["--log", log]);

    expect(stdout).toContain("4 distinct");
  });

  it("reports them under the model in JSON, deduplicated and sorted", async () => {
    const log = writeLog(withHashes(["bbbbbbbbbbbb", "aaaaaaaaaaaa", "bbbbbbbbbbbb"]));
    const [model] = await models(["--log", log]);

    expect(model!["promptHashes"]).toEqual(["aaaaaaaaaaaa", "bbbbbbbbbbbb"]);
  });

  it("says nothing about prompts for rows written before the field existed", async () => {
    // Absent is not the same as one prompt. Rows from before this
    // shipped must not collapse into a phantom single hash, which would
    // read as "these calls are comparable" without evidence.
    const log = writeLog(CALLS);
    const { stdout } = await usage(["--log", log]);
    const [model] = await models(["--log", log]);

    expect(stdout).not.toContain("prompt   ");
    expect(model).not.toHaveProperty("promptHashes");
  });
});
