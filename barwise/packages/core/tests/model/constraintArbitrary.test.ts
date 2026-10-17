/**
 * M1 on the constraint union (docs/specs/effect-adoption.spec.md): whether
 * Arbitrary.schema derives over all 16 kinds, with P1 (every derived value
 * encodes) and P2 (decoding the encoding returns it) over the samples.
 *
 * Self-consistency only: the Schema states structure, not the model's rules,
 * so these say nothing about validity. Seed and runs are fixed so a failure
 * reproduces.
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import { ConstraintSchema } from "../../src/model/constraintSchema.js";

const SEED = 1;
const RUNS = 1000;

describe("Arbitrary.schema over the constraint union (M1)", () => {
  const values = Effect.runSync(
    Arbitrary.sampleEffect(Arbitrary.schema(ConstraintSchema), { count: RUNS, seed: SEED }),
  );

  it("derives, and every derived value encodes and round-trips", () => {
    expect(values).toHaveLength(RUNS);
    for (const value of values) {
      const encoded = Schema.encodeSync(ConstraintSchema)(value);
      expect(Schema.decodeUnknownSync(ConstraintSchema)(encoded)).toEqual(value);
    }
  });

  it("reaches all 16 kinds", () => {
    expect(new Set(values.map((v) => v.type)).size).toBe(16);
  });
});
