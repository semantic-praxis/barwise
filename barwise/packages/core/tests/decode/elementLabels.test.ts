/**
 * A problem is labelled by the element it sits in, however deep
 * (docs/specs/effect-adoption.spec.md, 1r; second review of R1): the walk
 * meets each element's `element` annotation on the way down.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { expect, it } from "vitest";
import { decoderFor } from "../../src/decode/decoder.js";
import { ObjectTypeFile } from "../../src/decode/objectType.js";

const Doc = Schema.Struct({ things: Schema.Array(ObjectTypeFile) });

it("labels each problem by its element, not by the document", () => {
  const result = Effect.runSync(Effect.result(
    decoderFor(Doc)({
      things: [
        { id: "a", name: "Customer", kind: "entity" },
        null,
        { id: "c", name: "Rank", kind: "nonesuch" },
      ],
    }),
  ));
  expect(Result.isFailure(result)).toBe(true);
  const messages = Result.isFailure(result) ? result.failure.problems.map((p) => p.message) : [];
  expect(messages.sort()).toEqual([
    'Entity type "Customer": reference_mode is missing: an entity type must have a reference mode.',
    'Object type "Rank" must have kind "entity" or "value".',
    "Object type must be a mapping of fields.",
  ]);
});
