/**
 * Unit tests for Population model class and OrmModel population methods.
 *
 * Covers:
 *   - Population creation with and without instances
 *   - Instance CRUD (add, remove, get)
 *   - OrmModel add/get/remove/query methods
 *   - Referential integrity (fact type must exist)
 *   - Multiple populations per fact type
 */
import { describe, expect, it } from "vitest";
import { DuplicateIdError, OrmModel } from "../../src/model/OrmModel.js";
import { Population } from "../../src/model/Population.js";

function makeModel(): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const customer = model.addObjectType({
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
  });
  const order = model.addObjectType({
    name: "Order",
    kind: "entity",
    referenceMode: "order_number",
  });
  model.addFactType({
    name: "Customer places Order",
    roles: [
      { name: "places", playerId: customer.id, id: "r1" },
      { name: "is placed by", playerId: order.id, id: "r2" },
    ],
    readings: ["{0} places {1}"],
  });
  return model;
}

describe("Population", () => {
  describe("construction", () => {
    it("creates a population with generated id", () => {
      const pop = new Population({ factTypeId: "ft-1" });
      expect(pop.id).toBeDefined();
      expect(pop.id.length).toBeGreaterThan(0);
      expect(pop.factTypeId).toBe("ft-1");
      expect(pop.instances).toHaveLength(0);
    });

    it("creates a population with explicit id", () => {
      const pop = new Population({ id: "pop-1", factTypeId: "ft-1" });
      expect(pop.id).toBe("pop-1");
    });

    it("creates a population with initial instances", () => {
      const pop = new Population({
        factTypeId: "ft-1",
        instances: [
          { roleValues: { r1: "C001", r2: "O123" } },
          { roleValues: { r1: "C002", r2: "O124" } },
        ],
      });
      expect(pop.instances).toHaveLength(2);
      expect(pop.size).toBe(2);
    });

    it("stores description", () => {
      const pop = new Population({
        factTypeId: "ft-1",
        description: "Sample orders",
      });
      expect(pop.description).toBe("Sample orders");
    });
  });

  describe("instance management", () => {
    it("adds instances and returns them", () => {
      const pop = new Population({ factTypeId: "ft-1" });
      const inst = pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });

      expect(inst.id).toBeDefined();
      expect(inst.roleValues).toEqual({ r1: "C001", r2: "O123" });
      expect(pop.instances).toHaveLength(1);
    });

    it("adds instances with explicit id", () => {
      const pop = new Population({ factTypeId: "ft-1" });
      const inst = pop.addInstance({
        id: "inst-1",
        values: { r1: "C001", r2: "O123" },
      });
      expect(inst.id).toBe("inst-1");
    });

    it("gets an instance by id", () => {
      const pop = new Population({ factTypeId: "ft-1" });
      const inst = pop.addInstance({
        id: "inst-1",
        values: { r1: "C001", r2: "O123" },
      });
      expect(pop.getInstance("inst-1")).toBe(inst);
      expect(pop.getInstance("nonexistent")).toBeUndefined();
    });

    it("removes an instance by id", () => {
      const pop = new Population({ factTypeId: "ft-1" });
      pop.addInstance({ id: "inst-1", values: { r1: "C001", r2: "O123" } });
      pop.addInstance({ id: "inst-2", values: { r1: "C002", r2: "O124" } });

      pop.removeInstance("inst-1");
      expect(pop.instances).toHaveLength(1);
      expect(pop.getInstance("inst-1")).toBeUndefined();
      expect(pop.getInstance("inst-2")).toBeDefined();
    });

    it("throws when removing nonexistent instance", () => {
      const pop = new Population({ factTypeId: "ft-1" });
      expect(() => pop.removeInstance("bad-id")).toThrow("not found");
    });

    it("does not expose internal array for mutation", () => {
      const pop = new Population({ factTypeId: "ft-1" });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
      const instances = pop.instances;
      expect(instances).toHaveLength(1);
      // Mutating the returned array should not affect the population.
      (instances as unknown[]).push({ id: "fake", roleValues: {} });
      expect(pop.instances).toHaveLength(1);
    });
  });
});

describe("OrmModel population methods", () => {
  it("adds a population for an existing fact type", () => {
    const model = makeModel();
    const ft = model.getFactTypeByName("Customer places Order")!;

    const pop = model.addPopulation({
      factTypeId: ft.id,
      description: "Sample data",
    });

    expect(pop.factTypeId).toBe(ft.id);
    expect(model.populations).toHaveLength(1);
  });

  it("throws when adding population for nonexistent fact type", () => {
    const model = makeModel();
    expect(() => model.addPopulation({ factTypeId: "nonexistent" })).toThrow("does not exist");
  });

  it("retrieves a population by id", () => {
    const model = makeModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    const pop = model.addPopulation({ factTypeId: ft.id });

    expect(model.getPopulation(pop.id)).toBe(pop);
    expect(model.getPopulation("nonexistent")).toBeUndefined();
  });

  it("retrieves populations for a fact type", () => {
    const model = makeModel();
    const ft = model.getFactTypeByName("Customer places Order")!;

    model.addPopulation({ factTypeId: ft.id, description: "Set A" });
    model.addPopulation({ factTypeId: ft.id, description: "Set B" });

    const pops = model.populationsForFactType(ft.id);
    expect(pops).toHaveLength(2);
  });

  it("returns empty array for fact type with no populations", () => {
    const model = makeModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    expect(model.populationsForFactType(ft.id)).toHaveLength(0);
  });

  it("removes a population", () => {
    const model = makeModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    const pop = model.addPopulation({ factTypeId: ft.id });

    model.removePopulation(pop.id);
    expect(model.populations).toHaveLength(0);
    expect(model.getPopulation(pop.id)).toBeUndefined();
  });

  it("throws when removing nonexistent population", () => {
    const model = makeModel();
    expect(() => model.removePopulation("bad-id")).toThrow("not found");
  });

  it("includes populations in element count", () => {
    const model = makeModel();
    const countBefore = model.elementCount;
    const ft = model.getFactTypeByName("Customer places Order")!;
    model.addPopulation({ factTypeId: ft.id });
    expect(model.elementCount).toBe(countBefore + 1);
  });
});

describe("a fact instance id (barwise-wcg.4kp)", () => {
  it("is refused when another instance of the population already holds it", () => {
    const stated = { id: "F.population.1", roleValues: {} };
    expect(() => new Population({ factTypeId: "F", instances: [stated, stated] })).toThrow(
      /Id "F\.population\.1" is held by a fact instance of population "F\.population", so a second one/,
    );
    const pop = new Population({ factTypeId: "F", instances: [stated] });
    expect(() => pop.addInstance(stated)).toThrow(DuplicateIdError);
  });

  it("is never minted onto a number stated later in the same list", () => {
    const pop = new Population({
      factTypeId: "F",
      instances: [{ roleValues: {} }, { id: "F.population.1", roleValues: {} }],
    });
    expect(pop.instances.map((i) => i.id)).toEqual(["F.population.2", "F.population.1"]);
  });
});
