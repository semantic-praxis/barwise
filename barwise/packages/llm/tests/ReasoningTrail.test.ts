/**
 * Tests for reasoning-trail assembly: anchors (recomputed) + ambiguities +
 * discarded framings + low-confidence assumptions.
 */
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../src/LlmClient.js";
import { buildReasoningTrail } from "../src/ReasoningTrail.js";
import { processTranscript } from "../src/TranscriptProcessor.js";

function mockClient(json: string): LlmClient {
  return {
    async complete(_request: CompletionRequest) {
      return { content: json };
    },
  };
}

const canned = `{
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
    { "type": "mandatory", "fact_type": "Customer has CustomerId", "roles": ["Customer"], "description": "every customer has id", "confidence": "high", "source_references": [{ "lines": [1, 1], "excerpt": "x" }] },
    { "type": "frequency", "fact_type": "Customer has CustomerId", "roles": ["Customer"], "description": "a customer might have multiple ids over time", "confidence": "low", "min": 1, "max": "unbounded", "source_references": [{ "lines": [2, 2], "excerpt": "ids" }] }
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
        { "name": "Email", "kind": "value", "data_type": { "name": "text", "length": 100 }, "source_references": [{ "lines": [2, 2], "excerpt": "email" }] }
      ],
      "fact_types": [
        { "name": "Customer has Email", "roles": [{ "player": "Customer", "role_name": "has" }, { "player": "Email", "role_name": "identifies" }], "readings": ["{0} has {1}", "{1} identifies {0}"], "source_references": [{ "lines": [2, 2], "excerpt": "email" }] }
      ],
      "subtypes": [],
      "inferred_constraints": []
    }
  ]
}`;

describe("buildReasoningTrail", () => {
  it("assembles anchors, ambiguities, discarded framings, and assumptions", async () => {
    const result = await processTranscript("t", mockClient(canned), {
      modelName: "M",
      alternatives: true,
    });
    const trail = buildReasoningTrail(result);

    expect(trail.modelName).toBe("M");

    const customer = trail.anchors.find((a) => a.entity === "Customer");
    expect(customer).toBeDefined();
    expect(customer!.preferredIdentifier).toBeDefined();

    expect(trail.ambiguities).toContain("Email might also be a unique identifier");

    expect(trail.discardedFramings).toHaveLength(1);
    expect(trail.discardedFramings[0]!.rationale).toContain("Email");
    expect(trail.discardedFramings[0]!.resolves).toContain("Email");
    expect(trail.discardedFramings[0]!.diffSummary).toContain("added");

    expect(
      trail.assumptions.some((a) => a.description.includes("multiple ids")),
    ).toBe(true);
    expect(trail.assumptions.every((a) => a.confidence === "low")).toBe(true);
  });

  it("yields empty import-time sections when there are none", async () => {
    const bare = JSON.stringify({
      object_types: [],
      fact_types: [],
      inferred_constraints: [],
      ambiguities: [],
    });
    const result = await processTranscript("t", mockClient(bare), { modelName: "Bare" });
    const trail = buildReasoningTrail(result);
    expect(trail.ambiguities).toEqual([]);
    expect(trail.discardedFramings).toEqual([]);
    expect(trail.assumptions).toEqual([]);
  });
});
