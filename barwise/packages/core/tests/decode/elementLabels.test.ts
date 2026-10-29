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
import { elementOf } from "../../src/decode/problems.js";

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
    "Object type at things.1 must be a mapping of fields.",
  ]);
});

it("says where an element with no name sits, in the problem and its message", () => {
  const result = Effect.runSync(Effect.result(
    decoderFor(Doc)({ things: [{ id: "a", name: "Rank", kind: "value" }, null] }),
  ));
  const problems = Result.isFailure(result) ? result.failure.problems : [];
  expect(problems.map((p) => [p.at, p.path, p.message])).toEqual([
    [["things", 1], [], "Object type at things.1 must be a mapping of fields."],
  ]);
});

it("words a struct element that is not a mapping as one", () => {
  const Thing = Schema.Struct({ id: Schema.String }).annotate(
    elementOf({
      noun: "Thing",
      badTag: "is not a thing.",
      describe: () => ({ label: "Thing", identity: "" }),
    }),
  );
  const Things = Schema.Struct({ things: Schema.Array(Thing) });
  const result = Effect.runSync(Effect.result(decoderFor(Things)({ things: [{ id: "a" }, 3] })));
  const messages = Result.isFailure(result) ? result.failure.problems.map((p) => p.message) : [];
  expect(messages).toEqual(["Thing at things.1 must be a mapping of fields."]);
});
