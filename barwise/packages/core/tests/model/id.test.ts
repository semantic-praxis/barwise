/**
 * Ids outside a model (iri-identity WS6, 6b-4b). Core mints no random id:
 * an element built on its own takes the id the format's rules give it from
 * its name, and `formatUuid` remains only for `derivedId`'s v8.
 */
import { describe, expect, it } from "vitest";
import { FactType } from "../../src/model/FactType.js";
import { formatUuid } from "../../src/model/id.js";
import { createObjectType } from "../../src/model/ObjectType.js";
import { Population } from "../../src/model/Population.js";

describe("formatUuid", () => {
  it("writes 16 bytes as 8-4-4-4-12 hex, keeping leading zeros", () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => i);
    expect(formatUuid(bytes)).toBe("00010203-0405-0607-0809-0a0b0c0d0e0f");
  });

  it("refuses anything but 16 bytes", () => {
    expect(() => formatUuid(new Uint8Array(15))).toThrow(/16 bytes/);
  });
});

describe("an element built outside a model", () => {
  it("takes the id its name gives (decision 13), the same on every build", () => {
    const build = () =>
      createObjectType({ name: "Order Line", kind: "entity", referenceMode: "nr" });
    expect([build().id, build().id]).toEqual(["Order_Line", "Order_Line"]);
  });

  it("gives a fact type its name's id and each role its fact type's and its role name's", () => {
    const ft = new FactType({
      name: "Person knows Person",
      roles: [
        { name: "knows", playerId: "Person" },
        { name: "knows", playerId: "Person" },
        { name: "is known by", playerId: "Person", id: "stated.role" },
      ],
      readings: ["{0} knows {1} {2}"],
    });
    expect([ft.id, ...ft.roles.map((r) => r.id)]).toEqual([
      "Person_knows_Person",
      "Person_knows_Person.knows",
      "Person_knows_Person.knows_2",
      "stated.role",
    ]);
  });

  it("gives a population its fact type's id and .population (decision 7)", () => {
    expect(new Population({ factTypeId: "Person_smokes" }).id).toBe("Person_smokes.population");
    expect(new Population({ id: "given", factTypeId: "Person_smokes" }).id).toBe("given");
  });

  it("never overrides an id it is given", () => {
    expect(createObjectType({ id: "ot-1", name: "Person", kind: "entity", referenceMode: "nr" }).id)
      .toBe("ot-1");
  });
});
