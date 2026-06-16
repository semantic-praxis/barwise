/**
 * Tests for multi-candidate framing (#3): the extractor optionally returns
 * an alternative framing alongside the primary, diffed against it.
 *
 * Uses a mock LlmClient with a canned response, so no real LLM is called.
 * The canned response is a JSON template literal (kept out of dprint's way).
 */
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../src/LlmClient.js";
import { processTranscript } from "../src/TranscriptProcessor.js";

function mockClient(json: string): LlmClient {
  return {
    async complete(_request: CompletionRequest) {
      return { content: json };
    },
  };
}

// Primary models Customer identified by customer_id. The alternative adds
// Email as a second identifier, so the diff against the primary is non-empty.
const responseWithAlternative = `{
  "object_types": [
    { "name": "Customer", "kind": "entity", "reference_mode": "customer_id", "source_references": [{ "lines": [1, 1], "excerpt": "x" }] },
    { "name": "CustomerId", "kind": "value", "data_type": { "name": "text", "length": 20 }, "source_references": [{ "lines": [1, 1], "excerpt": "x" }] }
  ],
  "fact_types": [
    { "name": "Customer has CustomerId", "roles": [{ "player": "Customer", "role_name": "has" }, { "player": "CustomerId", "role_name": "identifies" }], "readings": ["{0} has {1}", "{1} identifies {0}"], "source_references": [{ "lines": [1, 1], "excerpt": "x" }] }
  ],
  "subtypes": [],
  "inferred_constraints": [
    { "type": "internal_uniqueness", "fact_type": "Customer has CustomerId", "roles": ["Customer"], "description": "one id", "confidence": "high", "is_preferred": true, "source_references": [{ "lines": [1, 1], "excerpt": "x" }] },
    { "type": "internal_uniqueness", "fact_type": "Customer has CustomerId", "roles": ["CustomerId"], "description": "one customer", "confidence": "high", "source_references": [{ "lines": [1, 1], "excerpt": "x" }] },
    { "type": "mandatory", "fact_type": "Customer has CustomerId", "roles": ["Customer"], "description": "every customer has id", "confidence": "high", "source_references": [{ "lines": [1, 1], "excerpt": "x" }] }
  ],
  "ambiguities": [
    { "description": "Email might also be a unique identifier", "source_references": [{ "lines": [2, 2], "excerpt": "email" }] }
  ],
  "alternatives": [
    {
      "rationale": "Models Email as the preferred identifier instead of customer_id",
      "ambiguity_description": "Email might also be a unique identifier",
      "object_types": [
        { "name": "Customer", "kind": "entity", "reference_mode": "customer_id", "source_references": [{ "lines": [1, 1], "excerpt": "x" }] },
        { "name": "CustomerId", "kind": "value", "data_type": { "name": "text", "length": 20 }, "source_references": [{ "lines": [1, 1], "excerpt": "x" }] },
        { "name": "Email", "kind": "value", "data_type": { "name": "text", "length": 100 }, "source_references": [{ "lines": [2, 2], "excerpt": "email" }] }
      ],
      "fact_types": [
        { "name": "Customer has CustomerId", "roles": [{ "player": "Customer", "role_name": "has" }, { "player": "CustomerId", "role_name": "identifies" }], "readings": ["{0} has {1}", "{1} identifies {0}"], "source_references": [{ "lines": [1, 1], "excerpt": "x" }] },
        { "name": "Customer has Email", "roles": [{ "player": "Customer", "role_name": "has" }, { "player": "Email", "role_name": "identifies" }], "readings": ["{0} has {1}", "{1} identifies {0}"], "source_references": [{ "lines": [2, 2], "excerpt": "email" }] }
      ],
      "subtypes": [],
      "inferred_constraints": [
        { "type": "internal_uniqueness", "fact_type": "Customer has CustomerId", "roles": ["Customer"], "description": "one id", "confidence": "high", "is_preferred": true, "source_references": [{ "lines": [1, 1], "excerpt": "x" }] }
      ]
    }
  ]
}`;

describe("multi-candidate framing", () => {
  it("returns no alternatives by default, even if the response carries them", async () => {
    const result = await processTranscript(
      "Some transcript",
      mockClient(responseWithAlternative),
      { modelName: "M" },
    );
    expect(result.alternatives).toBeUndefined();
  });

  it("returns a candidate framing with its diff when requested", async () => {
    const result = await processTranscript(
      "Some transcript",
      mockClient(responseWithAlternative),
      { modelName: "M", alternatives: true },
    );

    expect(result.alternatives).toBeDefined();
    expect(result.alternatives).toHaveLength(1);
    const framing = result.alternatives![0]!;
    expect(framing.rationale).toContain("Email");
    expect(framing.ambiguityDescription).toContain("Email");
    expect(framing.model.getObjectTypeByName("Email")).toBeDefined();
    // The primary has no Email; the diff must show changes.
    expect(framing.diff.hasChanges).toBe(true);
    expect(result.model.getObjectTypeByName("Email")).toBeUndefined();
  });

  it("requests the alternatives prompt and schema branch only when enabled", async () => {
    let captured: CompletionRequest | undefined;
    const client: LlmClient = {
      async complete(request: CompletionRequest) {
        captured = request;
        return { content: responseWithAlternative };
      },
    };

    await processTranscript("t", client, { alternatives: true });
    expect(captured!.systemPrompt).toContain("Alternative framings");
    expect(JSON.stringify(captured!.responseSchema)).toContain("alternatives");
  });

  it("omits the alternatives prompt and schema branch by default", async () => {
    let captured: CompletionRequest | undefined;
    const client: LlmClient = {
      async complete(request: CompletionRequest) {
        captured = request;
        return { content: responseWithAlternative };
      },
    };

    await processTranscript("t", client);
    expect(captured!.systemPrompt).not.toContain("Alternative framings");
    expect(JSON.stringify(captured!.responseSchema)).not.toContain("alternatives");
  });
});
