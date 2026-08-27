/**
 * The multi-sample fold and loop
 * (docs/specs/multi-sample-import.spec.md, workstreams 1-2).
 *
 * Mock clients with canned divergent payloads, per llm convention. The
 * pinned properties are the spec's: the fold is deterministic, the
 * medoid tie breaks to the earliest sample, disagreement becomes
 * ambiguity text with counts, a failed draw is excluded and reported,
 * and the emitted model is always one sample's verbatim output.
 */
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../src/LlmClient.js";
import { computeSampleAgreement } from "../src/sampleAgreement.js";
import { sampleTranscript } from "../src/sampleTranscript.js";
import { parseExtractionFromJson } from "../src/TranscriptProcessor.js";

/** Canned payload: Customer identified by CustomerId, optionally with Order. */
function payload(withOrder: boolean): string {
  const orderTypes = withOrder
    ? `,{ "name": "Order", "kind": "entity", "reference_mode": "order_number", "source_references": [{ "lines": [1, 1], "excerpt": "x" }] }`
    : "";
  const orderFts = withOrder
    ? `,{ "name": "Customer places Order", "roles": [{ "player": "Customer", "role_name": "places" }, { "player": "Order", "role_name": "is placed by" }], "readings": ["{0} places {1}"], "source_references": [{ "lines": [1, 1], "excerpt": "x" }] }`
    : "";
  return `{
    "object_types": [
      { "name": "Customer", "kind": "entity", "reference_mode": "customer_id", "source_references": [{ "lines": [1, 1], "excerpt": "x" }] },
      { "name": "CustomerId", "kind": "value", "source_references": [{ "lines": [1, 1], "excerpt": "x" }] }${orderTypes}
    ],
    "fact_types": [
      { "name": "Customer has CustomerId", "roles": [{ "player": "Customer", "role_name": "has" }, { "player": "CustomerId", "role_name": "identifies" }], "readings": ["{0} has {1}"], "source_references": [{ "lines": [1, 1], "excerpt": "x" }] }${orderFts}
    ],
    "subtypes": [],
    "inferred_constraints": [],
    "ambiguities": []
  }`;
}

function modelFrom(json: string) {
  return parseExtractionFromJson(json, "sample").model;
}

/** A client whose nth call returns the nth canned response (or throws). */
function sequenceClient(responses: (string | Error)[]): LlmClient {
  let call = 0;
  return {
    provider: "test",
    model: undefined,
    async complete(_request: CompletionRequest) {
      const next = responses[call++];
      if (next instanceof Error) throw next;
      return { content: next as string };
    },
  };
}

describe("computeSampleAgreement", () => {
  it("reports full agreement for identical samples, medoid at index 0", () => {
    const models = [modelFrom(payload(true)), modelFrom(payload(true)), modelFrom(payload(true))];
    const agreement = computeSampleAgreement(models);
    expect(agreement.medoidIndex).toBe(0);
    expect(agreement.disagreements).toHaveLength(0);
    expect(agreement.ambiguities).toHaveLength(0);
    expect(agreement.stable).toBe(5); // 3 object types + 2 fact types
  });

  it("picks the majority shape as medoid and reports the minority as presence counts", () => {
    const models = [
      modelFrom(payload(false)),
      modelFrom(payload(true)),
      modelFrom(payload(true)),
    ];
    const agreement = computeSampleAgreement(models);
    // The two with-Order samples agree with each other; either is a
    // valid medoid and the tie breaks to the earliest, index 1.
    expect(agreement.medoidIndex).toBe(1);
    const kinds = agreement.disagreements.map((d) => `${d.kind}:${d.name}`).sort();
    expect(kinds).toEqual(["presence:Customer places Order", "presence:Order"]);
    for (const d of agreement.disagreements) {
      expect(d.agreeing).toBe(2);
      expect(d.total).toBe(3);
    }
    expect(agreement.ambiguities[0]!.description).toContain("2 of 3");
  });

  it("is deterministic: same models in, byte-identical report out", () => {
    const build = () =>
      computeSampleAgreement([
        modelFrom(payload(false)),
        modelFrom(payload(true)),
        modelFrom(payload(true)),
      ]);
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});

describe("sampleTranscript", () => {
  it("emits the medoid verbatim with disagreements appended as ambiguities", async () => {
    const client = sequenceClient([payload(true), payload(false), payload(true)]);
    const result = await sampleTranscript("t", client, { samples: 3 });
    expect(result.agreement.medoidIndex).toBe(0);
    expect(result.model.getObjectTypeByName("Order")).toBeDefined();
    expect(result.samples.map((s) => s.status)).toEqual(["ok", "ok", "ok"]);
    expect(result.ambiguities.some((a) => a.description.includes("2 of 3"))).toBe(true);
  });

  it("excludes a failed draw, says so, and folds over the survivors", async () => {
    const client = sequenceClient([payload(true), new Error("boom"), payload(true)]);
    const result = await sampleTranscript("t", client, { samples: 3 });
    expect(result.samples.map((s) => s.status)).toEqual(["ok", "failed", "ok"]);
    expect(result.warnings.some((w) => w.includes("1 of 3") && w.includes("boom"))).toBe(true);
    expect(result.agreement.disagreements).toHaveLength(0);
  });

  it("rethrows when every draw fails", async () => {
    const client = sequenceClient([new Error("a"), new Error("b")]);
    await expect(sampleTranscript("t", client, { samples: 2 })).rejects.toThrow("b");
  });

  it("rejects a sample count outside the bounds", async () => {
    const client = sequenceClient([payload(true)]);
    await expect(sampleTranscript("t", client, { samples: 1 })).rejects.toThrow(/\[2, 5\]/);
    await expect(sampleTranscript("t", client, { samples: 6 })).rejects.toThrow(/\[2, 5\]/);
  });
});
