/**
 * barwise review (docs/specs/cli-surface-parity.spec.md, workstream 2).
 *
 * Mock client only -- no test in this repo makes a real LLM call, per
 * the `llm` package convention. A key is needed to exercise the command
 * against a provider, not to verify it works.
 *
 * The load-bearing test is the exit code one: review returns advice,
 * and a command that failed the build on model-generated advice would
 * put an LLM in the merge path.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const model = join(fixtures, "simple.orm.yaml");

const reviewPayload = {
  suggestions: [
    {
      category: "definition",
      severity: "warning",
      element: "Name",
      description: "Name has no definition.",
      rationale: "A value type without a definition is ambiguous to a reader.",
    },
    {
      category: "naming",
      severity: "suggestion",
      element: "Customer",
      description: "Consider whether Client is the house term.",
      rationale: "Consistency with the billing domain.",
    },
  ],
  summary: "One definition gap; naming is otherwise consistent.",
};

vi.mock("@barwise/llm", async () => {
  const actual = await vi.importActual<typeof import("@barwise/llm")>("@barwise/llm");
  return {
    ...actual,
    // `complete` resolves a minimal response rather than undefined: the
    // call-logging tests below wrap this client for real, and a
    // decorator reading `response.modelUsed` off undefined would fail
    // for a reason that has nothing to do with what they assert.
    createLlmClient: vi.fn(() => ({
      provider: "test",
      model: undefined,
      complete: vi.fn(() => Promise.resolve({ content: "{}" })),
    })),
    reviewModel: vi.fn(() => Promise.resolve(reviewPayload)),
  };
});

const { createLlmClient, reviewModel } = await import("@barwise/llm");
const { runCli } = await import("../workspace/run.js");

describe("barwise review", () => {
  beforeEach(() => {
    vi.mocked(reviewModel).mockClear();
  });

  it("prints each suggestion with its severity, and the summary", async () => {
    const result = await runCli(["review", model]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Name has no definition.");
    expect(result.stdout).toContain("[warning]");
    expect(result.stdout).toContain("A value type without a definition is ambiguous");
    expect(result.stdout).toContain("One definition gap");
  });

  it("exits zero even when a suggestion is a warning", async () => {
    // Deliberate: the payload above carries a warning. Review reports
    // advice, and advice does not fail a build. A user who wants a gate
    // pipes --format json through jq, keeping the policy theirs.
    const result = await runCli(["review", model]);
    expect(result.exitCode).toBe(0);
  });

  it("passes --focus through to the reviewer", async () => {
    await runCli(["review", model, "--focus", "Customer"]);
    expect(vi.mocked(reviewModel).mock.calls[0]![2]).toEqual({ focus: "Customer" });
  });

  it("omits focus entirely when not given, rather than passing undefined", async () => {
    await runCli(["review", model]);
    expect(vi.mocked(reviewModel).mock.calls[0]![2]).toEqual({});
  });

  it("emits the raw result under --format json", async () => {
    const result = await runCli(["review", model, "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.suggestions).toHaveLength(2);
    expect(parsed.summary).toBe(reviewPayload.summary);
  });

  it("exits non-zero when the model file is missing", async () => {
    const result = await runCli(["review", join(fixtures, "nope.orm.yaml")]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File not found");
    expect(vi.mocked(reviewModel)).not.toHaveBeenCalled();
  });

  it("prints 'No suggestions.' when the review has none", async () => {
    vi.mocked(reviewModel).mockResolvedValueOnce({ suggestions: [], summary: "Looks solid." });
    const result = await runCli(["review", model]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No suggestions.");
    expect(result.stdout).toContain("Looks solid.");
  });

  it("omits the element prefix for a suggestion with no element", async () => {
    vi.mocked(reviewModel).mockResolvedValueOnce({
      suggestions: [
        {
          category: "structure",
          severity: "suggestion",
          description: "Consider splitting this domain.",
          rationale: "It covers two unrelated concerns.",
        },
      ],
      summary: "One structural note.",
    });
    const result = await runCli(["review", model]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("[suggestion] Consider splitting this domain.");
  });

  it("reports a provider failure without pretending the review succeeded", async () => {
    vi.mocked(reviewModel).mockRejectedValueOnce(new Error("no API key configured"));
    const result = await runCli(["review", model]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no API key configured");
    expect(result.stdout).toBe("");
  });
});

describe("barwise review call logging", () => {
  // The call-log spec's Inventory marked this command `modify` and only
  // `import` was ever wired, so a review cost real tokens and left no
  // row -- `barwise llm-usage` under-reported by every review ever run
  // (docs/specs/artifact-resolution-parity.spec.md, workstream 2).
  let tmp: string;
  const SAVED = process.env["BARWISE_CALL_LOG"];

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "barwise-review-log-"));
    vi.mocked(reviewModel).mockClear();
    vi.mocked(createLlmClient).mockClear();
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    if (SAVED === undefined) delete process.env["BARWISE_CALL_LOG"];
    else process.env["BARWISE_CALL_LOG"] = SAVED;
  });

  /** Make the mocked reviewer actually spend a call, as the real one does. */
  function spendsACall(): void {
    vi.mocked(reviewModel).mockImplementationOnce(async (_model, client) => {
      await client.complete({ systemPrompt: "REVIEW-SYSTEM-PROMPT", userMessage: "the model" });
      return reviewPayload;
    });
  }

  it("records the call, with the hash of the prompt it sent", async () => {
    const log = join(tmp, "calls.jsonl");
    process.env["BARWISE_CALL_LOG"] = log;
    spendsACall();

    const result = await runCli(["review", model]);

    expect(result.exitCode).toBe(0);
    const rows = readFileSync(log, "utf-8").trim().split("\n").map((l) => JSON.parse(l));
    expect(rows).toHaveLength(1);
    expect(rows[0].ok).toBe(true);
    expect(rows[0].promptHash).toMatch(/^[0-9a-f]{12}$/);
    // The rule the whole log turns on, asserted over the serialised row.
    expect(JSON.stringify(rows)).not.toContain("REVIEW-SYSTEM-PROMPT");
    expect(JSON.stringify(rows)).not.toContain("the model");
  });

  it("wraps nothing when recording is off", async () => {
    // The negative is the one worth having: an operator who never asked
    // for a log must not acquire one, and must not pay for a wrapper.
    // Asserted by identity -- the reviewer gets the very object
    // `createLlmClient` returned, so nothing decorated it.
    delete process.env["BARWISE_CALL_LOG"];
    spendsACall();

    const result = await runCli(["review", model]);

    expect(result.exitCode).toBe(0);
    const built = vi.mocked(createLlmClient).mock.results.at(-1)!.value;
    expect(vi.mocked(reviewModel).mock.calls[0]![1]).toBe(built);
  });

  it("hands the reviewer a wrapper, not the bare client, when recording is on", async () => {
    process.env["BARWISE_CALL_LOG"] = join(tmp, "calls.jsonl");
    spendsACall();

    await runCli(["review", model]);

    const built = vi.mocked(createLlmClient).mock.results.at(-1)!.value;
    expect(vi.mocked(reviewModel).mock.calls[0]![1]).not.toBe(built);
  });
});
