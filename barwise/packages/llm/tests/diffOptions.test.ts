/**
 * Independent LLM samples are compared with content-only element
 * matching (orm-format-3, Open decision 4 as revised; barwise-18n). Their
 * ids are unrelated by construction. Under the default random generator
 * they never coincide, but under a deterministic one (tests, promptlab's
 * withDeterministicIds) they do by mint order, and id-first matching would
 * then pair two different elements; core's
 * `constraintMatching.test.ts` shows content-only never does. This pins
 * that both sample comparisons ask for it: the medoid fold and its
 * per-sample diffs, and an alternative framing's diff against the primary.
 */
import { describe, expect, it, vi } from "vitest";

const calls: unknown[][] = [];
vi.mock("@barwise/core/diff", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@barwise/core/diff")>();
  return {
    ...actual,
    diffModels: (...args: Parameters<typeof actual.diffModels>) => {
      calls.push(args);
      return actual.diffModels(...args);
    },
  };
});

const { computeSampleAgreement } = await import("../src/sampleAgreement.js");
const { parseExtractionFromJson, processTranscript } = await import(
  "../src/TranscriptProcessor.js"
);

const ref = `"source_references": [{ "lines": [1, 1], "excerpt": "x" }]`;
const body = `
  "object_types": [
    { "name": "Customer", "kind": "entity", "reference_mode": "customer_id", ${ref} },
    { "name": "CustomerId", "kind": "value", ${ref} }
  ],
  "fact_types": [
    { "name": "Customer has CustomerId", "roles": [{ "player": "Customer", "role_name": "has" }, { "player": "CustomerId", "role_name": "identifies" }], "readings": ["{0} has {1}"], ${ref} }
  ],
  "subtypes": [],
  "inferred_constraints": []`;
const json = `{ ${body}, "ambiguities": [] }`;

describe("sample comparisons pair elements by content only", () => {
  it("in the medoid fold and each sample's diff against it", () => {
    calls.length = 0;
    const model = () => parseExtractionFromJson(json, "sample").model;
    computeSampleAgreement([model(), model(), model()]);
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args[2]).toEqual({ matching: "content" });
  });

  it("in an alternative framing's diff against the primary", async () => {
    calls.length = 0;
    const withAlternative = `{ ${body}, "ambiguities": [], "alternatives": [{
      "rationale": "r", "ambiguity_description": "a", ${body} }] }`;
    const result = await processTranscript(
      "Some transcript",
      {
        provider: "test",
        model: undefined,
        async complete() {
          return { content: withAlternative };
        },
      },
      { modelName: "M", alternatives: true },
    );
    expect(result.alternatives).toHaveLength(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]![2]).toEqual({ matching: "content" });
  });
});
