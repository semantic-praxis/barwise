/**
 * Tests for the summarize- and build-summary functions that
 * describeDomain composes. Most branches are exercised end-to-end via
 * describeDomain (see describeDomain.test.ts); these tests cover shapes
 * that are awkward to assemble through that surface -- more than ten
 * entities or constraints, dangling model references, and the
 * population/definition fields being present or absent.
 */
import { describe, expect, it } from "vitest";
import { describeDomain } from "../../src/describe/describeDomain.js";
import {
  buildConstraintTypeFocusSummary,
  buildEntityFocusSummary,
  buildFactTypeFocusSummary,
  buildFullSummary,
  summarizePopulation,
} from "../../src/describe/summaries.js";
import type {
  ConstraintSummary,
  EntitySummary,
  PopulationSummary,
} from "../../src/describe/types.js";
import { ModelNotResolvableError } from "../../src/model/graph.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { Population } from "../../src/model/Population.js";
import { graphFor } from "../helpers/graphFor.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("summarizeFactType", () => {
  it("reports the unresolvable reference instead of describing around it", () => {
    const model = new OrmModel({ name: "Test" });
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    model.addFactType(
      {
        name: "Customer places Order",
        roles: [
          { id: "r1", name: "places", playerId: customer.id },
          { id: "r2", name: "is placed by", playerId: "missing-order-type" },
        ],
        readings: ["{0} places {1}", "{1} is placed by {0}"],
      },
      { skipPlayerValidation: true },
    );

    // This used to return "missing-order-type" among the involved
    // entities -- an id where a name belongs, pinned as behaviour. What a
    // caller actually got at the surface was worse: `barwise describe` on
    // such a model died with "Cannot read properties of undefined
    // (reading 'playerId')". Both are replaced by one named failure.
    expect(() => describeDomain(model)).toThrow(ModelNotResolvableError);
    expect(() => describeDomain(model)).toThrow("missing-order-type");
  });
});

describe("summarizePopulation", () => {
  it("falls back to the raw fact type id when the population's fact type is missing", () => {
    const model = new OrmModel({ name: "Test" });
    const population = new Population({ factTypeId: "missing-ft" });

    const summary = summarizePopulation(model, population);
    expect(summary.factTypeName).toBe("missing-ft");
  });
});

describe("buildFullSummary", () => {
  it("includes the domain context line when the model declares one", () => {
    const model = new OrmModel({ name: "Shop", domainContext: "retail" });
    const text = buildFullSummary(model, [], [], [], undefined);
    expect(text).toContain("Context: retail");
  });

  it("omits the domain context line when the model has none", () => {
    const model = new OrmModel({ name: "Shop" });
    const text = buildFullSummary(model, [], [], [], undefined);
    expect(text).not.toContain("Context:");
  });

  it("truncates the entity list past ten and notes how many more there are", () => {
    const model = new OrmModel({ name: "Big" });
    const entities: EntitySummary[] = Array.from({ length: 13 }, (_, i) => ({
      id: `e${i}`,
      name: `Entity${i}`,
      kind: "entity",
    }));
    const text = buildFullSummary(model, entities, [], [], undefined);
    expect(text).toContain("... and 3 more");
    expect(text).not.toContain("Entity12"); // 13th entity, past the cutoff
  });
});

describe("buildEntityFocusSummary", () => {
  function entity() {
    const model = new ModelBuilder("Test").withEntityType("Widget", { referenceMode: "widget_id" })
      .build();
    return model.getObjectTypeByName("Widget")!;
  }

  it("omits the reference mode line for a value type with none", () => {
    const model = new OrmModel({ name: "Test" });
    const valueType = model.addObjectType({ name: "Note", kind: "value" });
    const text = buildEntityFocusSummary(valueType, [], [], undefined);
    expect(text).not.toContain("Reference Mode:");
  });

  it("truncates the constraint list past ten and notes how many more there are", () => {
    const e = entity();
    const constraints: ConstraintSummary[] = Array.from({ length: 12 }, (_, i) => ({
      id: `c${i}`,
      type: "mandatory",
      verbalization: `Constraint ${i}`,
      affectedFactType: "ft",
    }));
    const text = buildEntityFocusSummary(e, [], constraints, undefined);
    expect(text).toContain("... and 2 more");
  });

  it("lists population instance counts when populations are supplied", () => {
    const e = entity();
    const populations: PopulationSummary[] = [
      {
        factTypeId: "ft1",
        factTypeName: "Widget is active",
        instanceCount: 4,
        sampleInstances: [],
      },
    ];
    const text = buildEntityFocusSummary(e, [], [], populations);
    expect(text).toContain("Populations: 1");
    expect(text).toContain("Widget is active: 4 instances");
  });
});

describe("buildFactTypeFocusSummary", () => {
  it("names every role's player, with no list for a caller to filter", () => {
    const model = new OrmModel({ name: "Test" });
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const order = model.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_id" });
    const ft = model.addFactType({
      name: "Customer places Order",
      roles: [
        { id: "r1", name: "places", playerId: customer.id },
        { id: "r2", name: "is placed by", playerId: order.id },
      ],
      readings: ["{0} places {1}", "{1} is placed by {0}"],
    });

    // This used to take an `entities` list and print the raw id for any
    // role whose player the caller had filtered out -- a test pinned that
    // as behaviour. The graph is not a list a caller assembles, so the
    // case is designed out rather than handled.
    const text = buildFactTypeFocusSummary(ft, graphFor(model), [], undefined);
    expect(text).toContain("played by Customer");
    expect(text).toContain("played by Order");
    expect(text).not.toContain(order.id);
  });

  it("shows a population's description and sample instances when present", () => {
    const model = new OrmModel({ name: "Test" });
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const ft = model.addFactType({
      name: "Customer is active",
      roles: [{ id: "r1", name: "is active", playerId: customer.id }],
      readings: ["{0} is active"],
    });

    const populations: PopulationSummary[] = [
      {
        factTypeId: ft.id,
        factTypeName: ft.name,
        description: "Known active customers",
        instanceCount: 1,
        sampleInstances: [{ id: "i1", roleValues: { r1: "C001" } }],
      },
    ];

    const text = buildFactTypeFocusSummary(ft, graphFor(model), [], populations);
    expect(text).toContain("Description: Known active customers");
    expect(text).toContain("Sample:");
    expect(text).toContain("r1=C001");
  });

  it("falls back to 'Sample data' and omits the sample section when instances are absent", () => {
    const model = new OrmModel({ name: "Test" });
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const ft = model.addFactType({
      name: "Customer is active",
      roles: [{ id: "r1", name: "is active", playerId: customer.id }],
      readings: ["{0} is active"],
    });

    const populations: PopulationSummary[] = [
      { factTypeId: ft.id, factTypeName: ft.name, instanceCount: 0, sampleInstances: [] },
    ];

    const text = buildFactTypeFocusSummary(ft, graphFor(model), [], populations);
    expect(text).toContain("Description: Sample data");
    expect(text).not.toContain("Sample:");
  });
});

describe("buildConstraintTypeFocusSummary", () => {
  it("lists each constraint tagged with its affected fact type", () => {
    const constraints: ConstraintSummary[] = [
      {
        id: "c1",
        type: "mandatory",
        verbalization: "Each X has some Y.",
        affectedFactType: "X has Y",
      },
    ];
    const text = buildConstraintTypeFocusSummary("mandatory", constraints);
    expect(text).toContain("Constraint Type: mandatory");
    expect(text).toContain("[X has Y] Each X has some Y.");
  });
});
