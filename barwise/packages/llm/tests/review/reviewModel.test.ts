/**
 * Tests for reviewModel: LLM-powered semantic quality assessment.
 *
 * Uses mock LlmClient for determinism. Tests verify:
 *   - Prompt construction includes model content
 *   - Focus parameter filters the review scope
 *   - Response parsing handles well-formed output
 *   - Response parsing handles malformed output
 *   - Suggestions are correctly categorized
 */

import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../../src/LlmClient.js";
import { reviewModel } from "../../src/review/reviewModel.js";

/**
 * Mock LLM client that returns canned responses.
 */
function createMockClient(responseJson: string): LlmClient {
  return {
    provider: "test",
    model: undefined,
    async complete(_request: CompletionRequest) {
      return { content: responseJson };
    },
  };
}

/**
 * Mock client that captures the request for inspection.
 */
function createCapturingClient(): {
  client: LlmClient;
  getCaptured: () => CompletionRequest | undefined;
} {
  let captured: CompletionRequest | undefined;
  return {
    client: {
      provider: "test",
      model: undefined,
      async complete(request: CompletionRequest) {
        captured = request;
        return {
          content: JSON.stringify({
            suggestions: [],
            summary: "Model looks good.",
          }),
        };
      },
    },
    getCaptured: () => captured,
  };
}

/**
 * Build a simple test model without external dependencies.
 */
function buildTestModel(name: string = "Test Model"): OrmModel {
  const model = new OrmModel({
    name,
  });

  model.addObjectType({
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
  });

  return model;
}

/**
 * Build a model with multiple entities for testing focus.
 */
function buildMultiEntityModel(): OrmModel {
  const model = new OrmModel({
    name: "Multi-Entity Model",
  });

  model.addObjectType({
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
    definition: "A customer.",
  });

  model.addObjectType({
    name: "Order",
    kind: "entity",
    referenceMode: "order_id",
  });

  return model;
}

describe("reviewModel", () => {
  it("calls LLM with system prompt and model content", async () => {
    const model = buildTestModel();

    const { client, getCaptured } = createCapturingClient();

    await reviewModel(model, client);

    const captured = getCaptured();
    expect(captured).toBeDefined();
    expect(captured!.systemPrompt).toContain("ORM 2");
    expect(captured!.systemPrompt).toContain("review");
    expect(captured!.userMessage).toContain("Customer");
    expect(captured!.responseSchema).toBeDefined();
  });

  it("includes focus parameter in user message when provided", async () => {
    const model = buildMultiEntityModel();

    const { client, getCaptured } = createCapturingClient();

    await reviewModel(model, client, { focus: "Customer" });

    const captured = getCaptured();
    expect(captured).toBeDefined();
    expect(captured!.userMessage).toContain("Customer");
    expect(captured!.userMessage).toContain("focusing on");
  });

  it("parses well-formed LLM response", async () => {
    const model = buildTestModel();

    const mockResponse = JSON.stringify({
      suggestions: [
        {
          category: "definition",
          severity: "suggestion",
          element: "Customer",
          description: "Customer entity lacks a definition",
          rationale: "Definitions help developers understand the domain",
        },
        {
          category: "completeness",
          severity: "warning",
          element: "Customer",
          description: "Customer has no constraints",
          rationale: "Unconstrained entity types may indicate missing business rules",
        },
      ],
      summary: "Model needs more definitions and constraints.",
    });

    const client = createMockClient(mockResponse);

    const result = await reviewModel(model, client);

    expect(result.suggestions).toHaveLength(2);
    expect(result.suggestions[0]!.category).toBe("definition");
    expect(result.suggestions[0]!.severity).toBe("suggestion");
    expect(result.suggestions[0]!.element).toBe("Customer");
    expect(result.suggestions[1]!.category).toBe("completeness");
    expect(result.suggestions[1]!.severity).toBe("warning");
    expect(result.summary).toBe("Model needs more definitions and constraints.");
  });

  it("handles LLM response with no suggestions", async () => {
    const model = buildTestModel();

    const mockResponse = JSON.stringify({
      suggestions: [],
      summary: "Model is well-defined with no significant issues.",
    });

    const client = createMockClient(mockResponse);

    const result = await reviewModel(model, client);

    expect(result.suggestions).toHaveLength(0);
    expect(result.summary).toBe("Model is well-defined with no significant issues.");
  });

  it("throws on malformed JSON response", async () => {
    const model = buildTestModel();

    const client = createMockClient("not valid json");

    await expect(reviewModel(model, client)).rejects.toThrow("Failed to parse");
  });

  it("throws when response is missing required fields", async () => {
    const model = buildTestModel();

    const mockResponse = JSON.stringify({
      suggestions: [],
      // missing summary
    });

    const client = createMockClient(mockResponse);

    await expect(reviewModel(model, client)).rejects.toThrow("missing 'summary'");
  });

  it("serializes model with entity types and definitions", async () => {
    const model = buildMultiEntityModel();

    const { client, getCaptured } = createCapturingClient();

    await reviewModel(model, client);

    const captured = getCaptured();
    expect(captured).toBeDefined();
    expect(captured!.userMessage).toContain("Customer");
    expect(captured!.userMessage).toContain("Order");
    expect(captured!.userMessage).toContain("Definition: A customer");
    expect(captured!.userMessage).toContain("Definition: (none)"); // Order has no definition
  });
});
