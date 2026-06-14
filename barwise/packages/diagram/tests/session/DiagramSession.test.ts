/**
 * Unit tests for DiagramSession: the interactive-diagram state extracted
 * from DiagramPanel. Drives intents and asserts on the returned
 * DiagramPresentation -- the behavioral parity guard for logic that had
 * no coverage while it lived in the VS Code panel.
 */
import { describe, expect, it } from "vitest";
import type { OrmModel } from "@barwise/core";
import { ModelBuilder } from "../../../core/tests/helpers/ModelBuilder.js";
import { DiagramSession } from "../../src/session/DiagramSession.js";

/** A relates to B relates to C (3 entities, 2 binary fact types). */
function chainModel(): OrmModel {
  return new ModelBuilder("Chain")
    .withEntityType("A", { referenceMode: "id" })
    .withEntityType("B", { referenceMode: "id" })
    .withEntityType("C", { referenceMode: "id" })
    .withBinaryFactType("A relates to B", {
      role1: { player: "A", name: "relates to" },
      role2: { player: "B", name: "is related to by" },
    })
    .withBinaryFactType("B relates to C", {
      role1: { player: "B", name: "relates to" },
      role2: { player: "C", name: "is related to by" },
    })
    .build();
}

const otId = (m: OrmModel, name: string) => m.getObjectTypeByName(name)!.id;

describe("DiagramSession", () => {
  it("presents the full model with no focus or view", async () => {
    const model = chainModel();
    const p = await new DiagramSession(model).present();

    expect(p.modelName).toBe("Chain");
    expect(p.focus).toBeNull();
    expect(p.view).toBeNull();
    expect(p.hasUnsavedLayout).toBe(false);
    expect(p.ghostNodeIds).toEqual([]);
    // 3 object types + 2 fact types.
    expect(p.graph.nodes).toHaveLength(5);
  });

  it("filters to a focus entity's neighborhood", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    session.apply({ type: "focusEntity", nodeId: otId(model, "A"), hopCount: 1 });
    const p = await session.present();

    // One hop from A keeps A, B, and the A-B fact type.
    expect(p.graph.nodes).toHaveLength(3);
    expect(p.focus).toEqual({ entityId: otId(model, "A"), entityName: "A", hopCount: 1 });
  });

  it("widens the neighborhood with a larger hop count, then clears", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    session.apply({ type: "focusEntity", nodeId: otId(model, "A"), hopCount: 2 });
    expect((await session.present()).graph.nodes).toHaveLength(5);

    session.apply({ type: "clearFocus" });
    const p = await session.present();
    expect(p.focus).toBeNull();
    expect(p.graph.nodes).toHaveLength(5);
  });

  it("marks the layout unsaved after a node move", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    await session.present(); // establish the layout for drag conversion

    session.apply({ type: "moveNode", nodeId: otId(model, "A"), x: 999, y: 999 });
    const p = await session.present();

    expect(p.hasUnsavedLayout).toBe(true);
  });

  it("shows ghost neighbors and clears them", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    // Load a one-entity view so ghosts have a filter to extend.
    model.addDiagramLayout({ name: "JustA", positions: {}, orientations: {}, elements: ["A"] });

    session.apply({ type: "loadView", viewName: "JustA" });
    const focused = await session.present();
    expect(focused.view).toEqual({ viewName: "JustA", hasGhosts: false });
    expect(focused.graph.nodes).toHaveLength(1); // only A

    session.apply({ type: "showNeighbors", nodeId: otId(model, "A") });
    const withGhosts = await session.present();
    expect(withGhosts.view?.hasGhosts).toBe(true);
    expect(withGhosts.ghostNodeIds.length).toBeGreaterThan(0);
    // B is pulled in as a ghost, with the A-B fact type.
    expect(withGhosts.graph.nodes.length).toBeGreaterThan(1);

    session.apply({ type: "clearGhosts" });
    const cleared = await session.present();
    expect(cleared.ghostNodeIds).toEqual([]);
    expect(cleared.view?.hasGhosts).toBe(false);
  });

  it("lists available views from the model", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "V1", positions: {}, orientations: {}, elements: ["A"] });
    model.addDiagramLayout({ name: "V2", positions: {}, orientations: {}, elements: ["B"] });

    const p = await new DiagramSession(model).present();
    expect([...p.availableViews].sort()).toEqual(["V1", "V2"]);
  });

  it("focuses an element by kind via applyHighlight (fact type)", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    const ftId = model.getFactTypeByName("A relates to B")!.id;

    session.applyHighlight(ftId, "fact_type");
    const p = await session.present();

    // The filter seeds both role players (A, B) and expands each one hop.
    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names).toContain("A");
    expect(names).toContain("B");
    expect(p.focus).not.toBeNull();
  });

  it("expands an active view filter by one hop on live reload", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "JustA", positions: {}, orientations: {}, elements: ["A"] });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "JustA" });
    expect((await session.present()).graph.nodes).toHaveLength(1); // only A

    // A document change re-parses the model (ids are stable); the active
    // view expands one hop to pull in fact types / entities that touch the
    // displayed submodel.
    session.setModel(model);
    const p = await session.present();
    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names).toContain("B");
  });

  it("assembles a save-layout with sorted center positions", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    await session.present();
    // Pin entities by moving one (pinAllEntitiesIfNeeded fires).
    session.apply({ type: "moveNode", nodeId: otId(model, "A"), x: 100, y: 200 });
    await session.present();

    const layout = session.buildLayout("Default");
    expect(layout.name).toBe("Default");
    // Every object type has a saved position; keys are sorted.
    expect(Object.keys(layout.positions)).toEqual(["A", "B", "C"]);
    for (const pos of Object.values(layout.positions)) {
      expect(Number.isInteger(pos.x)).toBe(true);
      expect(Number.isInteger(pos.y)).toBe(true);
    }
  });

  it("assembles a save-view with element names", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "AB", positions: {}, orientations: {}, elements: ["A", "B"] });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "AB" });
    await session.present();

    const view = session.buildViewLayout("My View");
    expect(view.name).toBe("My View");
    expect([...(view.elements ?? [])].sort()).toEqual(["A", "B"]);
  });

  it("focuses a subtype fact via applyHighlight", async () => {
    const model = new ModelBuilder("Sub")
      .withEntityType("Person", { referenceMode: "id" })
      .withEntityType("Employee", { referenceMode: "id" })
      .withSubtypeFact("Employee", "Person")
      .build();
    const session = new DiagramSession(model);
    const sfId = model.subtypeFacts[0]!.id;

    session.applyHighlight(sfId, "subtype_fact");
    const p = await session.present();

    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names).toContain("Person");
    expect(names).toContain("Employee");
    expect(p.focus).not.toBeNull();
  });

  it("toggles fact-type orientation and marks the layout unsaved", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    await session.present();
    const ftId = model.getFactTypeByName("A relates to B")!.id;

    session.apply({ type: "toggleOrientation", nodeId: ftId });
    const p = await session.present();

    expect(p.hasUnsavedLayout).toBe(true);
  });

  it("treats selectElement as a no-op", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    await session.present();

    session.apply({ type: "selectElement", elementId: otId(model, "A") });
    const p = await session.present();

    expect(p.focus).toBeNull();
    expect(p.hasUnsavedLayout).toBe(false);
  });

  it("ignores addGhostToView without an active view", () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    expect(session.addGhostToView(otId(model, "A"))).toBeNull();
  });

  it("promotes a ghost into the active view and reports the name", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "JustA", positions: {}, orientations: {}, elements: ["A"] });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "JustA" });
    await session.present();
    session.apply({ type: "showNeighbors", nodeId: otId(model, "A") });
    await session.present();

    const promoted = session.addGhostToView(otId(model, "B"));
    expect(promoted).toBe("B");

    // B is now a permanent member: present without ghosts still shows it.
    session.apply({ type: "clearGhosts" });
    const p = await session.present();
    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names).toContain("B");
  });
});
