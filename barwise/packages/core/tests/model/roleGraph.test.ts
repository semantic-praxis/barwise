/**
 * Tests for the shared role-graph traversal primitive `hopsFrom`.
 *
 * `hopsFrom` is the single adjacency walk under both the query path search
 * and the forthcoming role-path constraints. These tests pin its shape: one
 * hop per (entry role played by the object, other role of the same fact
 * type), ring hops included, deterministic order.
 */
import { describe, expect, it } from "vitest";
import { hopsFrom } from "../../src/model/roleGraph.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

function idOf(model: ReturnType<ModelBuilder["build"]>, name: string): string {
  const ot = model.getObjectTypeByName(name);
  if (!ot) throw new Error(`no object type ${name}`);
  return ot.id;
}

describe("hopsFrom", () => {
  it("yields one hop across a binary fact type, in each direction", () => {
    const model = new ModelBuilder("Shop")
      .withEntityType("Customer")
      .withEntityType("Order")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const customer = idOf(model, "Customer");
    const order = idOf(model, "Order");

    const fromCustomer = hopsFrom(model, customer);
    expect(fromCustomer).toHaveLength(1);
    expect(fromCustomer[0]!.factType.name).toBe("Customer places Order");
    expect(fromCustomer[0]!.entryRole.playerId).toBe(customer);
    expect(fromCustomer[0]!.exitRole.playerId).toBe(order);

    const fromOrder = hopsFrom(model, order);
    expect(fromOrder).toHaveLength(1);
    expect(fromOrder[0]!.exitRole.playerId).toBe(customer);
  });

  it("yields a hop per fact type the object participates in", () => {
    const model = new ModelBuilder("Shop")
      .withEntityType("Customer")
      .withEntityType("Order")
      .withValueType("Name")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
      })
      .build();

    const hops = hopsFrom(model, idOf(model, "Customer"));
    expect(hops).toHaveLength(2);
    expect(hops.map((h) => h.exitRole.playerId).sort()).toEqual(
      [idOf(model, "Name"), idOf(model, "Order")].sort(),
    );
  });

  it("includes ring hops when the object plays both roles", () => {
    const model = new ModelBuilder("Org")
      .withEntityType("Person")
      .withBinaryFactType("Person reports to Person", {
        role1: { player: "Person", name: "reports to" },
        role2: { player: "Person", name: "manages" },
      })
      .build();

    const person = idOf(model, "Person");
    const hops = hopsFrom(model, person);
    // Both roles are played by Person, so each is an entry with the other as
    // exit: two hops, both arriving back at Person.
    expect(hops).toHaveLength(2);
    expect(hops.every((h) => h.exitRole.playerId === person)).toBe(true);
    expect(hops[0]!.entryRole.id).not.toBe(hops[0]!.exitRole.id);
  });

  it("returns no hops for an object that plays no role", () => {
    const model = new ModelBuilder("Shop")
      .withEntityType("Customer")
      .withEntityType("Orphan")
      .withBinaryFactType("Customer has Customer", {
        role1: { player: "Customer", name: "refers" },
        role2: { player: "Customer", name: "is referred by" },
      })
      .build();

    expect(hopsFrom(model, idOf(model, "Orphan"))).toEqual([]);
  });

  it("is deterministic across calls", () => {
    const model = new ModelBuilder("Shop")
      .withEntityType("Customer")
      .withEntityType("Order")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const a = hopsFrom(model, idOf(model, "Customer"));
    const b = hopsFrom(model, idOf(model, "Customer"));
    expect(a.map((h) => h.exitRole.id)).toEqual(b.map((h) => h.exitRole.id));
  });
});
