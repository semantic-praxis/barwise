/**
 * What the pipeline changed, kept as categories rather than prose
 * (docs/specs/pipeline-observability.spec.md).
 *
 * `enforceConformance` returns `{category, description, element}` and
 * `processTranscript` flattened it to `warnings: string[]` one line
 * later, so the category was unrecoverable downstream and no surface
 * could count corrections by kind. The concrete cost: whether the
 * ring-player and population fixes moved the recorded baselines could
 * not be read off the record.
 *
 * The record deliberately does not live on `DraftModelResult` -- that
 * type answers what model a transcript produced and where each part
 * came from, which is a different question with a different lifetime.
 */
import { describe, expect, it } from "vitest";
import type { ConformanceCorrection } from "../../src/ExtractionConformance.js";
import { emitExtractionRecord, summariseExtraction } from "../../src/observe/extractionLog.js";

const AT = "2026-08-22T12:00:00.000Z";

function corrections(...categories: string[]): ConformanceCorrection[] {
  return categories.map((category) => ({
    category,
    // Transcript-derived wording, which is exactly what must not reach
    // the record.
    description:
      `Removed constraint "each Shipment sits in at most two Warehouses" -- ${category}.`,
    element: "Shipment sits in Warehouse",
  }));
}

const BUILT = { objectTypes: 3, factTypes: 2, constraints: 4 };

describe("summariseExtraction", () => {
  it("counts corrections by category", () => {
    const record = summariseExtraction({
      startedAt: AT,
      corrections: corrections("arity_mismatch", "invalid_bounds", "arity_mismatch"),
      parserWarnings: ["a", "b"],
      constraintsSkipped: 1,
      built: BUILT,
    });

    expect(record.correctionsByCategory).toEqual({
      arity_mismatch: 2,
      invalid_bounds: 1,
    });
    expect(record.corrections).toBe(3);
    expect(record.parserWarnings).toBe(2);
    expect(record.constraintsSkipped).toBe(1);
    expect(record.built).toEqual(BUILT);
  });

  it("records no prose from any correction", () => {
    // The rule the whole design turns on. A correction's description
    // quotes the constraint's own description, which is
    // transcript-derived wording, and a telemetry file that quietly
    // accumulated the transcripts users feed it would be that mistake
    // written to disk. Asserted over the serialised record, because a
    // field added later without thought is exactly how this leaks.
    const record = summariseExtraction({
      startedAt: AT,
      corrections: corrections("arity_mismatch"),
      parserWarnings: ['Constraint "each Order belongs to one Customer": could not resolve'],
      constraintsSkipped: 0,
      built: BUILT,
    });

    const serialised = JSON.stringify(record);
    expect(serialised).not.toContain("Shipment sits in at most two Warehouses");
    expect(serialised).not.toContain("Order belongs to one Customer");
    expect(serialised).not.toContain("Removed constraint");
  });

  it("is empty rather than absent when nothing was corrected", () => {
    const record = summariseExtraction({
      startedAt: AT,
      corrections: [],
      parserWarnings: [],
      constraintsSkipped: 0,
      built: BUILT,
    });

    expect(record.correctionsByCategory).toEqual({});
    expect(record.corrections).toBe(0);
  });

  it("carries a correlation id when given and omits it when not", () => {
    const withId = summariseExtraction({
      startedAt: AT,
      correlationId: "run-1",
      corrections: [],
      parserWarnings: [],
      constraintsSkipped: 0,
      built: BUILT,
    });
    const without = summariseExtraction({
      startedAt: AT,
      corrections: [],
      parserWarnings: [],
      constraintsSkipped: 0,
      built: BUILT,
    });

    expect(withId.correlationId).toBe("run-1");
    expect("correlationId" in without).toBe(false);
  });
});

describe("emitExtractionRecord", () => {
  it("hands the record to the sink", () => {
    const seen: unknown[] = [];
    emitExtractionRecord(
      { record: (e) => seen.push(e) },
      summariseExtraction({
        startedAt: AT,
        corrections: corrections("arity_mismatch"),
        parserWarnings: [],
        constraintsSkipped: 0,
        built: BUILT,
      }),
    );

    expect(seen).toHaveLength(1);
  });

  it("swallows a throwing sink", () => {
    // Observability that can fail the operation it observes is worse
    // than none: an extraction that cost a paid call must not be lost
    // because a state directory was unwritable.
    expect(() =>
      emitExtractionRecord(
        {
          record: () => {
            throw new Error("disk full");
          },
        },
        summariseExtraction({
          startedAt: AT,
          corrections: [],
          parserWarnings: [],
          constraintsSkipped: 0,
          built: BUILT,
        }),
      )
    ).not.toThrow();
  });

  it("does nothing without a sink", () => {
    expect(() =>
      emitExtractionRecord(
        undefined,
        summariseExtraction({
          startedAt: AT,
          corrections: [],
          parserWarnings: [],
          constraintsSkipped: 0,
          built: BUILT,
        }),
      )
    ).not.toThrow();
  });
});
