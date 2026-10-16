/**
 * Config inputs whose behaviour a review found had changed or was never
 * right. Each case is one main handles in a particular way, and the decoder
 * must keep handling it that way.
 */
import { afterEach, describe, expect, it } from "vitest";
import { setIdGenerator } from "../../src/model/id.js";
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

describe("addObjectType checks the name before it builds anything", () => {
  afterEach(() => setIdGenerator(undefined));

  it("reports the duplicate, as main does, when the config is also invalid", () => {
    const model = new OrmModel({ name: "M" });
    model.addObjectType({ name: "Customer", kind: "value" });
    expect(() => model.addObjectType({ name: "Customer", kind: "entity", referenceMode: "" }))
      .toThrow('Object type "Customer" already exists in model "M".');
  });

  it("mints no id for a config it refuses as a duplicate", () => {
    const model = new OrmModel({ name: "M" });
    model.addObjectType({ name: "Customer", kind: "value" });
    let minted = 0;
    setIdGenerator(() => `id-${++minted}`);
    expect(() => model.addObjectType({ name: " Customer ", kind: "value" })).toThrow(
      "already exists",
    );
    expect(minted).toBe(0);
  });
});

describe("a config's unknown keys are ignored, as main ignores them", () => {
  // main read the fields it knew and dropped the rest, and a config built by
  // spreading a wider object relies on that; a file is still held to its
  // schema, and the value-only fields are still refused on an entity.
  it("builds the record without the extra key", () => {
    const config = { name: "Rating", kind: "value" as const, colour: "red" };
    const ot = createObjectType(config);
    expect(ot.name).toBe("Rating");
    expect("colour" in ot).toBe(false);
  });

  it("ignores an extra key inside a nested field too", () => {
    const ot = createObjectType({
      name: "Rating",
      kind: "value",
      dataType: { name: "integer", colour: "red" } as { name: string; },
    });
    expect(ot.kind === "value" && ot.dataType).toEqual({ name: "integer" });
  });

  it("still refuses a value-only field on an entity", () => {
    expect(() =>
      createObjectType(
        {
          name: "Supplier",
          kind: "entity",
          referenceMode: "supplier_id",
          dataType: { name: "integer" },
        } as Parameters<typeof createObjectType>[0],
      )
    ).toThrow('Entity type "Supplier" cannot have');
  });
});
