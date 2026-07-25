/**
 * Tests for the model-only annotation entry points: collectModelAnnotations
 * (derives the relational schema internally) and collectAnnotationMap
 * (needs-attention annotations keyed by model element id, the diagram
 * graph's input shape).
 */
import { describe, expect, it } from "vitest";
import {
  collectAnnotationMap,
  collectModelAnnotations,
} from "../../src/annotation/exportAnnotationMap.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/** An entity with no definition: guaranteed table-level "todo". */
function modelWithGap(): OrmModel {
  const model = new OrmModel({ name: "Gaps" });
  const customer = model.addObjectType({
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
  });
  const name = model.addObjectType({ name: "CustomerName", kind: "value" });
  model.addFactType({
    name: "Customer has CustomerName",
    roles: [
      { name: "has", playerId: customer.id, id: "r-c" },
      { name: "names", playerId: name.id, id: "r-n" },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { type: "internal_uniqueness", roleIds: ["r-c"] },
    ],
  });
  return model;
}

describe("collectModelAnnotations", () => {
  it("collects annotations without the caller supplying a schema", () => {
    const annotations = collectModelAnnotations(modelWithGap());
    expect(annotations.length).toBeGreaterThan(0);
    expect(annotations.some((a) => a.severity === "todo")).toBe(true);
  });
});

describe("collectAnnotationMap", () => {
  it("keys needs-attention annotations by model element id", () => {
    const model = modelWithGap();
    const customer = model.getObjectTypeByName("Customer")!;

    const map = collectAnnotationMap(model);
    const entries = map.get(customer.id);
    expect(entries).toBeDefined();
    expect(entries!.some((m) => m.startsWith("TODO(barwise):"))).toBe(true);
  });

  it("excludes note-severity annotations", () => {
    const model = modelWithGap();
    // Give the entity a definition: the description gap flips from a
    // table-level todo to an informational note, which must not mark
    // the node.
    model.getObjectTypeByName("Customer")!.definition = "A buyer of goods.";

    const map = collectAnnotationMap(model);
    for (const messages of map.values()) {
      for (const m of messages) {
        expect(m.startsWith("TODO(barwise):")).toBe(true);
      }
    }
  });
});
