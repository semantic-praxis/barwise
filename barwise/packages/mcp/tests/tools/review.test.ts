/**
 * Tests for the review_model tool.
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { executeReview } from "../../src/tools/review.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

// Mock the @barwise/llm module
vi.mock("@barwise/llm", async () => {
  const actual = await vi.importActual("@barwise/llm");
  return {
    ...actual,
    reviewModel: vi.fn(),
    createLlmClient: vi.fn(() => ({
      complete: vi.fn(),
    })),
  };
});

describe("review_model tool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls reviewModel with the resolved model", async () => {
    const { reviewModel } = await import("@barwise/llm");

    vi.mocked(reviewModel).mockResolvedValue({
      suggestions: [
        {
          category: "definition",
          severity: "suggestion",
          element: "Customer",
          description: "Customer lacks a definition",
          rationale: "Definitions help understanding",
        },
      ],
      summary: "Model needs definitions.",
    });

    const result = await executeReview(`${fixtures}/simple.orm.yaml`);

    expect(reviewModel).toHaveBeenCalledTimes(1);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(result.content[0]!.text).toContain("Model Review");
  });

  it("formats suggestions grouped by category", async () => {
    const { reviewModel } = await import("@barwise/llm");

    vi.mocked(reviewModel).mockResolvedValue({
      suggestions: [
        {
          category: "definition",
          severity: "suggestion",
          element: "Customer",
          description: "Customer lacks a definition",
          rationale: "Definitions help understanding",
        },
        {
          category: "definition",
          severity: "warning",
          element: "Order",
          description: "Order lacks a definition",
          rationale: "Key entities should be defined",
        },
        {
          category: "constraint",
          severity: "info",
          element: "Customer places Order",
          description: "Consider a uniqueness constraint",
          rationale: "May prevent duplicate orders",
        },
      ],
      summary: "Model needs work.",
    });

    const result = await executeReview(`${fixtures}/simple.orm.yaml`);

    const text = result.content[0]!.text;
    expect(text).toContain("Model Review");
    expect(text).toContain("Summary");
    expect(text).toContain("Suggestions (3)");
    expect(text).toContain("### Definition");
    expect(text).toContain("### Constraint");
    expect(text).toContain("**SUGGESTION (Customer)**");
    expect(text).toContain("**WARNING (Order)**");
    expect(text).toContain("**INFO (Customer places Order)**");
  });

  it("handles no suggestions", async () => {
    const { reviewModel } = await import("@barwise/llm");

    vi.mocked(reviewModel).mockResolvedValue({
      suggestions: [],
      summary: "Model looks good!",
    });

    const result = await executeReview(`${fixtures}/simple.orm.yaml`);

    const text = result.content[0]!.text;
    expect(text).toContain("No suggestions");
    expect(text).toContain("looks good");
  });

  it("passes focus parameter to reviewModel", async () => {
    const { reviewModel } = await import("@barwise/llm");

    vi.mocked(reviewModel).mockResolvedValue({
      suggestions: [],
      summary: "Focused review complete.",
    });

    await executeReview(`${fixtures}/simple.orm.yaml`, "Customer");

    expect(reviewModel).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      { focus: "Customer" },
    );
  });

  it("passes provider and model options to createLlmClient", async () => {
    const { reviewModel, createLlmClient } = await import("@barwise/llm");

    vi.mocked(reviewModel).mockResolvedValue({
      suggestions: [],
      summary: "Review complete.",
    });

    await executeReview(
      `${fixtures}/simple.orm.yaml`,
      undefined,
      "openai",
      "gpt-4o",
    );

    expect(createLlmClient).toHaveBeenCalledWith({
      provider: "openai",
      model: "gpt-4o",
    });
  });

  it("returns content in MCP format", async () => {
    const { reviewModel } = await import("@barwise/llm");

    vi.mocked(reviewModel).mockResolvedValue({
      suggestions: [],
      summary: "All good.",
    });

    const result = await executeReview(`${fixtures}/simple.orm.yaml`);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
    expect(typeof result.content[0]!.text).toBe("string");
  });

  describe("project source", () => {
    const project = `${fixtures}/project/project.orm-project.yaml`;

    it("reviews every domain under a header when no domain is given", async () => {
      const { reviewModel } = await import("@barwise/llm");
      vi.mocked(reviewModel).mockResolvedValue({
        suggestions: [],
        summary: "Looks good.",
      });

      const result = await executeReview(project);

      expect(reviewModel).toHaveBeenCalledTimes(2);
      const text = result.content[0]!.text;
      expect(text).toContain("== crm ==");
      expect(text).toContain("== billing ==");
    });

    it("reviews only the chosen domain without a header", async () => {
      const { reviewModel } = await import("@barwise/llm");
      vi.mocked(reviewModel).mockResolvedValue({
        suggestions: [],
        summary: "Looks good.",
      });

      const result = await executeReview(project, undefined, undefined, undefined, "crm");

      expect(reviewModel).toHaveBeenCalledTimes(1);
      expect(result.content[0]!.text).not.toContain("== crm ==");
    });
  });
});
