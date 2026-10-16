/**
 * The probes in effect-adoption.spec.md (Grounding), kept as tests. A
 * derived generator produces decoded values, so each value is encoded
 * before it is checked (P1), and decoding the encoding must return the
 * same value (P2). Both are self-consistency checks: the expected answer
 * comes from the codec alone. The independent check is P3, against the
 * hand-written JSON Schema, and it lands in a later commit.
 *
 * Runs and seed are fixed so a failure reproduces. Derivation is unstable
 * in the pinned Effect (4.0.4); if an upgrade breaks it, the spec's
 * fallback is open decision 5, option (b).
 */
import * as Arbitrary from "effect/Arbitrary";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";
import {
  ObjectTypeModelCodec,
  ObjectTypeYamlCodec,
} from "../../src/model/objectTypeSchema.js";

const SEED = 1;

describe("Arbitrary.schema over the object type codecs (spike probes)", () => {
  it("derives the YAML codec: 1,000 of 1,000 values encode and round-trip", () => {
    const values = Effect.runSync(
      Arbitrary.sampleEffect(Arbitrary.schema(ObjectTypeYamlCodec), {
        count: 1000,
        seed: SEED,
      }),
    );
    expect(values).toHaveLength(1000);
    for (const value of values) {
      const encoded = Schema.encodeSync(ObjectTypeYamlCodec)(value);
      expect(Schema.decodeUnknownSync(ObjectTypeYamlCodec)(encoded)).toEqual(value);
    }
  });

  it("derives the model codec once its config leaf carries a link: 200 of 200 values round-trip", () => {
    const values = Effect.runSync(
      Arbitrary.sampleEffect(Arbitrary.schema(ObjectTypeModelCodec), {
        count: 200,
        seed: SEED,
      }),
    );
    expect(values).toHaveLength(200);
    for (const value of values) {
      const encoded = Schema.encodeSync(ObjectTypeModelCodec)(value);
      expect(Schema.decodeUnknownSync(ObjectTypeModelCodec)(encoded)).toEqual(value);
    }
  });
});
