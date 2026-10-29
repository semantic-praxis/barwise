/**
 * `renameInModel` (iri-identity WS5): rename an object type, a fact type or
 * a role, rewrite what names it, and refuse what would break the model.
 */
import { describe, expect, it } from "vitest";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { RenameError, renameInModel } from "../../src/rename/renameInModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const serializer = new OrmYamlSerializer();

/**
 * A shop: Customer is keyed by the value type CustomerId through a binary,
 * so the mapper types its key from `customer_id`. Currency carries the same
 * reference-mode string without playing CustomerId, which the mapper never
 * ties to it.
 */
const SHOP = `orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-customer, name: Customer, kind: entity, reference_mode: customer_id }
    - { id: ot-cid, name: CustomerId, kind: value }
    - { id: ot-currency, name: Currency, kind: entity, reference_mode: customer_id }
    - { id: ot-order, name: Order, kind: entity, reference_mode: order_nr }
    - { id: ot-email, name: Email, kind: value }
  fact_types:
    - id: ft-cid
      name: Customer has CustomerId
      roles:
        - { id: r1, player: ot-customer, role_name: has }
        - { id: r2, player: ot-cid, role_name: of }
      readings: ["{0} has {1}"]
    - id: ft-email
      name: Customer has Email
      roles:
        - { id: r3, player: ot-customer, role_name: has }
        - { id: r4, player: ot-email, role_name: has }
      readings: ["{0} has {1}"]
    - id: ft-places
      name: Customer places Order
      roles:
        - { id: r5, player: ot-customer, role_name: places }
        - { id: r6, player: ot-order, role_name: placed by }
      readings: ["{0} places {1}"]
  populations:
    - { id: pop-places, fact_type: ft-places, instances: [] }
  definitions:
    - { term: Customer, definition: "A person who buys." }
    - { term: Order, definition: "A request to buy." }
`;

const shop = (): OrmModel => serializer.deserialize(SHOP);

describe("renameInModel", () => {
  it("renames an object type, keeps every id, and leaves its input alone", () => {
    const before = shop();
    const { model, ids } = renameInModel(before, { kind: "objectType", name: "Order" }, "Purchase");
    expect(model.getObjectTypeByName("Purchase")?.id).toBe("ot-order");
    expect(model.getObjectTypeByName("Order")).toBeUndefined();
    expect(before.getObjectTypeByName("Order")?.id).toBe("ot-order");
    expect(ids.size).toBe(0);
    // Every reference is an id, so the fact type still holds it.
    expect(model.getFactType("ft-places")?.roles[1]?.playerId).toBe("ot-order");
  });

  it("renames a fact type and a role, by name or by position", () => {
    const ft = renameInModel(
      shop(),
      { kind: "factType", name: "Customer places Order" },
      "Customer orders",
    );
    expect(ft.model.getFactType("ft-places")?.name).toBe("Customer orders");

    const byName = renameInModel(shop(), {
      kind: "role",
      factType: "Customer places Order",
      role: "places",
    }, "orders");
    expect(byName.model.getFactType("ft-places")?.roles[0]?.name).toBe("orders");

    const byPosition = renameInModel(shop(), {
      kind: "role",
      factType: "Customer has Email",
      role: 1,
    }, "of");
    expect(byPosition.model.getFactType("ft-email")?.roles.map((r) => r.name)).toEqual([
      "has",
      "of",
    ]);
  });

  it("refuses a role name two roles share, naming their positions", () => {
    expect(() =>
      renameInModel(shop(), { kind: "role", factType: "Customer has Email", role: "has" }, "x")
    ).toThrow(/2 roles named "has" \(positions 0, 1\)/);
  });

  it("round-trips: the result serializes and loads again", () => {
    const { model } = renameInModel(shop(), { kind: "objectType", name: "Customer" }, "Client");
    const again = serializer.deserialize(serializer.serialize(model));
    expect(again.getObjectTypeByName("Client")?.id).toBe("ot-customer");
  });

  it("rewrites the element's definition, and leaves it when the new term exists", () => {
    const renamed = renameInModel(shop(), { kind: "objectType", name: "Customer" }, "Client");
    expect(renamed.model.definitions.map((d) => d.term)).toEqual(["Client", "Order"]);
    expect(renamed.changes).toContain('Renamed the definition of "Customer" to "Client".');

    const taken = shop();
    taken.addDefinition({ term: "Purchase", definition: "Another sense." });
    const left = renameInModel(taken, { kind: "objectType", name: "Order" }, "Purchase");
    expect(left.model.definitions.filter((d) => d.term === "Purchase")).toHaveLength(1);
    expect(left.model.definitions.some((d) => d.term === "Order")).toBe(true);
    expect(left.changes).toContain(
      'Left the definition of "Order": a definition of "Purchase" already exists.',
    );
  });

  it("rewrites the reference mode the mapper reads from a renamed value type, and only that one", () => {
    const { model, changes } = renameInModel(
      shop(),
      { kind: "objectType", name: "CustomerId" },
      "ClientKey",
    );
    expect(model.getObjectType("ot-customer")).toMatchObject({ referenceMode: "client_key" });
    // Currency has the same string but does not play the value type.
    expect(model.getObjectType("ot-currency")).toMatchObject({ referenceMode: "customer_id" });
    expect(changes).toContain(
      'Changed the reference mode of "Customer" from "customer_id" to "client_key".',
    );
  });

  it("leaves an entity's reference mode alone when the entity itself is renamed", () => {
    const { model } = renameInModel(shop(), { kind: "objectType", name: "Customer" }, "Client");
    expect(model.getObjectType("ot-customer")).toMatchObject({ referenceMode: "customer_id" });
  });

  it("leaves free text alone", () => {
    const m = shop();
    m.note = "Every Customer is reviewed.";
    const { model } = renameInModel(m, { kind: "objectType", name: "Customer" }, "Client");
    expect(model.note).toBe("Every Customer is reviewed.");
  });

  it.each(
    [
      [{ kind: "objectType", name: "Nobody" }, "X", /No object type named "Nobody"/],
      [{ kind: "factType", name: "Nobody" }, "X", /No fact type named "Nobody"/],
      [{ kind: "objectType", name: "Order" }, "  ", /The new name is empty/],
      [{ kind: "objectType", name: "Order" }, "Order", /already named "Order"/],
      [
        { kind: "objectType", name: "Order" },
        "Customer",
        /already an object type named "Customer"/,
      ],
      [
        { kind: "objectType", name: "Order" },
        "Customer_has_Email",
        /local name "Customer_has_Email" with fact type/,
      ],
      [
        { kind: "factType", name: "Customer has Email" },
        "Customer",
        /local name "Customer" with object type/,
      ],
      [{ kind: "role", factType: "Customer places Order", role: 5 }, "x", /no role at position 5/],
      [
        { kind: "role", factType: "Customer places Order", role: "places" },
        "placed_by",
        /decision 5/,
      ],
      [
        { kind: "role", factType: "Customer places Order", role: "places" },
        "population",
        /decision 7/,
      ],
    ] as const,
  )("refuses %j to %j", (target, to, reason) => {
    expect(() => renameInModel(shop(), target, to)).toThrow(RenameError);
    expect(() => renameInModel(shop(), target, to)).toThrow(reason);
  });

  it("refuses a shadow, which is renamed through its owner", () => {
    const m = shop();
    m.addObjectType({
      name: "Invoice",
      kind: "entity",
      referenceMode: "invoice_nr",
      sourceContext: "billing",
    });
    expect(() => renameInModel(m, { kind: "objectType", name: "Invoice" }, "Bill")).toThrow(
      /shadow of an object type owned by "billing"/,
    );
  });

  it("renames a model that loaded leniently with a dangling reference", () => {
    const dangling = serializer.deserialize(
      `orm_version: "3.0"
model:
  name: M
  object_types:
    - { id: a, name: A, kind: entity, reference_mode: a_id }
  fact_types:
    - id: f
      name: A likes Ghost
      roles:
        - { id: r1, player: a, role_name: likes }
        - { id: r2, player: ghost, role_name: liked by }
      readings: ["{0} likes {1}"]
`,
      { lenient: true },
    );
    const { model } = renameInModel(dangling, { kind: "objectType", name: "A" }, "B");
    expect(model.getObjectTypeByName("B")?.id).toBe("a");
  });
});
