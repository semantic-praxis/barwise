/**
 * Config inputs whose behaviour a review found had changed or was never
 * right. Each case is one main handles in a particular way, and the decoder
 * must keep handling it that way.
 */
import { describe, expect, it } from "vitest";
import { createObjectType } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";

describe("addObjectType refuses a name already taken, once trimmed", () => {
  it("refuses a padded duplicate", () => {
    const model = new OrmModel({ name: "M" });
    model.addObjectType({ name: "Customer", kind: "value" });
    expect(() => model.addObjectType({ name: " Customer ", kind: "value" })).toThrow(
      "already exists",
    );
  });
});

describe("a value type's empty reference mode is absent, as main treats it", () => {
  it("builds the value type without a reference mode", () => {
    const ot = createObjectType({ name: "Thing", kind: "value", referenceMode: "" });
    expect(ot.kind).toBe("value");
    expect("referenceMode" in ot).toBe(false);
  });
});
