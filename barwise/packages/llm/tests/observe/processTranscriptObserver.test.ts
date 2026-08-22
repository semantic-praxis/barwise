/**
 * `processTranscript` reports what it changed, to a sink the caller
 * supplies (docs/specs/pipeline-observability.spec.md).
 *
 * The seam is the same one the run date and the build provenance
 * already use: the pipeline computes, the caller supplies the I/O. The
 * alternative -- hanging the corrections on `DraftModelResult` --
 * widens a type that answers a different question and is already
 * carrying call telemetry it should not.
 */
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../../src/LlmClient.js";
import type { ExtractionRecord } from "../../src/observe/extractionLog.js";
import { processTranscript } from "../../src/TranscriptProcessor.js";

const REF = [{ lines: [1, 2] as [number, number], excerpt: "test" }];

/**
 * A payload carrying one constraint conformance must remove: a
 * disjunctive mandatory over a single role, which the validator rejects
 * outright (barwise-826).
 */
const PAYLOAD = JSON.stringify({
  object_types: [
    { name: "Order", kind: "entity", source_references: REF },
    { name: "Customer", kind: "entity", source_references: REF },
  ],
  fact_types: [{
    name: "Customer places Order",
    reading: "Customer places Order",
    roles: [
      { player: "Customer", role_name: "places" },
      { player: "Order", role_name: "is placed by" },
    ],
    source_references: REF,
  }],
  subtypes: [],
  inferred_constraints: [{
    type: "disjunctive_mandatory",
    fact_type: "Customer places Order",
    roles: ["Customer"],
    description: "every customer places something",
    confidence: "high",
    source_references: REF,
  }],
  ambiguities: [],
});

function client(): LlmClient {
  return {
    provider: "test",
    model: undefined,
    async complete(_request: CompletionRequest) {
      return { content: PAYLOAD };
    },
  };
}

describe("processTranscript with an observer", () => {
  it("emits one record naming the correction's category", async () => {
    const seen: ExtractionRecord[] = [];
    await processTranscript("Customers place orders.", client(), {
      observer: { record: (e) => seen.push(e) },
      now: () => "2026-08-22T12:00:00.000Z",
      correlationId: "import-1",
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]!.correctionsByCategory).toEqual({ arity_mismatch: 1 });
    expect(seen[0]!.corrections).toBe(1);
    expect(seen[0]!.correlationId).toBe("import-1");
    expect(seen[0]!.startedAt).toBe("2026-08-22T12:00:00.000Z");
  });

  it("counts what reached the model", async () => {
    const seen: ExtractionRecord[] = [];
    await processTranscript("Customers place orders.", client(), {
      observer: { record: (e) => seen.push(e) },
      now: () => "2026-08-22T12:00:00.000Z",
    });

    expect(seen[0]!.built).toEqual({
      objectTypes: 2,
      factTypes: 1,
      // The malformed constraint was removed, so none reached it.
      constraints: 0,
    });
  });

  it("adds nothing to DraftModelResult", async () => {
    // The design decision, asserted rather than left to review.
    // Corrections must reach the observer and must NOT appear on the
    // extraction result, which answers a different question.
    const result = await processTranscript("Customers place orders.", client(), {
      observer: { record: () => {} },
      now: () => "2026-08-22T12:00:00.000Z",
    });

    expect("corrections" in result).toBe(false);
    expect("correctionsByCategory" in result).toBe(false);
  });

  it("still renders the correction as prose for the user", async () => {
    // Additive, not a replacement. Surfaces show `warnings` to users,
    // and a user who stopped being told their constraint was dropped
    // would be worse off than before the record existed.
    const result = await processTranscript("Customers place orders.", client(), {
      observer: { record: () => {} },
      now: () => "2026-08-22T12:00:00.000Z",
    });

    expect(result.warnings.some((w) => /Removed constraint/.test(w))).toBe(true);
  });

  it("behaves identically with no observer", async () => {
    const withOut = await processTranscript("Customers place orders.", client());
    const withIn = await processTranscript("Customers place orders.", client(), {
      observer: { record: () => {} },
      now: () => "2026-08-22T12:00:00.000Z",
    });

    expect(withOut.warnings).toEqual(withIn.warnings);
    expect(withOut.model.factTypes.length).toBe(withIn.model.factTypes.length);
  });

  it("does not fail the extraction when the sink throws", async () => {
    // A paid call must not be lost to an unwritable log.
    const result = await processTranscript("Customers place orders.", client(), {
      observer: {
        record: () => {
          throw new Error("disk full");
        },
      },
      now: () => "2026-08-22T12:00:00.000Z",
    });

    expect(result.model.factTypes).toHaveLength(1);
  });
});
