/**
 * A decoder problem inside a nested field names that field. Without the
 * name, two problems on data_type (length and scale) read the same.
 */
import { describe, expect, it } from "vitest";
import {
  decodeObjectType,
  ObjectTypeError,
  runObjectTypeDecode,
} from "../../src/model/objectTypeDecoder.js";

describe("a nested negative size names its field", () => {
  it("tells a negative length from a negative scale", () => {
    let messages: string[] = [];
    try {
      runObjectTypeDecode(
        decodeObjectType({
          id: "ot-1",
          name: "Size",
          kind: "value",
          data_type: { name: "text", length: -1, scale: -2 },
        }),
      );
    } catch (e) {
      messages = (e as ObjectTypeError).problems.map((p) => p.message);
    }
    expect(messages).toEqual([
      'Value type "Size" must have a non-negative length.',
      'Value type "Size" must have a non-negative scale.',
    ]);
  });
});
