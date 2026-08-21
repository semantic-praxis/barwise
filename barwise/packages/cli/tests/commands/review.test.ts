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
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    createLlmClient: vi.fn(() => ({ provider: "test", model: undefined, complete: vi.fn() })),
    reviewModel: vi.fn(() => Promise.resolve(reviewPayload)),
  };
});

const { reviewModel } = await import("@barwise/llm");
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

  it("reports a provider failure without pretending the review succeeded", async () => {
    vi.mocked(reviewModel).mockRejectedValueOnce(new Error("no API key configured"));
    const result = await runCli(["review", model]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no API key configured");
    expect(result.stdout).toBe("");
  });
});
