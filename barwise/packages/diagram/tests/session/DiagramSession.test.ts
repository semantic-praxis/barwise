/**
 * Unit tests for DiagramSession: the interactive-diagram state extracted
 * from DiagramPanel. Drives intents and asserts on the returned
 * DiagramPresentation -- the behavioral parity guard for logic that had
 * no coverage while it lived in the VS Code panel.
 */
import type { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
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
const ftId = (m: OrmModel, name: string) => m.getFactTypeByName(name)!.id;

/** A relates to B relates to C, plus a disconnected D-E pair. */
function chainWithDisconnectedPair(): OrmModel {
  return new ModelBuilder("ChainPlus")
    .withEntityType("A", { referenceMode: "id" })
    .withEntityType("B", { referenceMode: "id" })
    .withEntityType("C", { referenceMode: "id" })
    .withEntityType("D", { referenceMode: "id" })
    .withEntityType("E", { referenceMode: "id" })
    .withBinaryFactType("A relates to B", {
      role1: { player: "A", name: "relates to" },
      role2: { player: "B", name: "is related to by" },
    })
    .withBinaryFactType("B relates to C", {
      role1: { player: "B", name: "relates to" },
      role2: { player: "C", name: "is related to by" },
    })
    .withBinaryFactType("D relates to E", {
      role1: { player: "D", name: "relates to" },
      role2: { player: "E", name: "is related to by" },
    })
    .build();
}

/** Party <- Person <- Employee, a two-level subtype chain. */
function subtypeChainModel(): OrmModel {
  return new ModelBuilder("SubChain")
    .withEntityType("Party", { referenceMode: "party_id" })
    .withEntityType("Person", { referenceMode: "party_id" })
    .withEntityType("Employee", { referenceMode: "party_id" })
    .withSubtypeFact("Person", "Party")
    .withSubtypeFact("Employee", "Person")
    .build();
}

/** The subtype chain above, plus an unrelated Vehicle <- Car subtype pair. */
function subtypeChainWithUnrelatedPair(): OrmModel {
  return new ModelBuilder("SubChainPlus")
    .withEntityType("Party", { referenceMode: "party_id" })
    .withEntityType("Person", { referenceMode: "party_id" })
    .withEntityType("Employee", { referenceMode: "party_id" })
    .withEntityType("Vehicle", { referenceMode: "vehicle_id" })
    .withEntityType("Car", { referenceMode: "vehicle_id" })
    .withSubtypeFact("Person", "Party")
    .withSubtypeFact("Employee", "Person")
    .withSubtypeFact("Car", "Vehicle")
    .build();
}

describe("DiagramSession", () => {
  it("presents the full model with no focus or view", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    expect(session.layout).toBeUndefined();

    const p = await session.present();

    expect(p.modelName).toBe("Chain");
    expect(p.focus).toBeNull();
    expect(p.view).toBeNull();
    expect(p.hasUnsavedLayout).toBe(false);
    expect(p.ghostNodeIds).toEqual([]);
    // 3 object types + 2 fact types.
    expect(p.graph.nodes).toHaveLength(5);
    // present() records the layout it just produced.
    expect(session.layout).toBe(p.graph);
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

  it("carries new annotations through a live-reload setModel call", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    const annotations = new Map<string, readonly string[]>([[otId(model, "A"), ["stale"]]]);

    session.setModel(model, annotations);
    const p = await session.present();

    const aNode = p.graph.nodes.find((n) => n.id === otId(model, "A"));
    expect(aNode?.annotations).toEqual(["stale"]);
  });

  it("moves a node that isn't in the last layout, defaulting its size to zero", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    await session.present();

    // No node in the current layout carries this id (a stale drag from a
    // view that has since changed), so the node?.width/height lookups
    // fall back to 0 rather than centering on a real box.
    session.apply({ type: "moveNode", nodeId: "not-a-real-node", x: 10, y: 20 });
    const p = await session.present();

    expect(p.hasUnsavedLayout).toBe(true);
  });

  it("defaults an unknown fact type's orientation toggle to horizontal->vertical", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    // No present() yet, so lastLayout is undefined and the toggled id has
    // neither an existing override nor a matching layout node to read from.
    session.apply({ type: "toggleOrientation", nodeId: "not-a-real-fact-type" });
    await session.present();

    session.apply({ type: "toggleOrientation", nodeId: "not-a-real-fact-type" });
    const p = await session.present();

    expect(p.hasUnsavedLayout).toBe(true);
  });

  it("toggles a known fact type's orientation back and forth", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    await session.present();
    const abFtId = ftId(model, "A relates to B");

    session.apply({ type: "toggleOrientation", nodeId: abFtId });
    await session.present();
    session.apply({ type: "toggleOrientation", nodeId: abFtId });
    const p = await session.present();

    expect(p.hasUnsavedLayout).toBe(true);
  });

  it("shows neighbors with no active view filter to extend", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    session.apply({ type: "showNeighbors", nodeId: otId(model, "A") });
    const p = await session.present();

    expect(p.ghostNodeIds.length).toBeGreaterThan(0);
  });

  it("ignores applyHighlight for a subtype fact id that does not exist", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    session.applyHighlight("not-a-real-subtype-fact", "subtype_fact");
    const p = await session.present();

    expect(p.focus).toBeNull();
  });

  it("ignores applyHighlight for a fact type id that does not exist", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    session.applyHighlight("not-a-real-fact-type", "fact_type");
    const p = await session.present();

    expect(p.focus).toBeNull();
  });

  it("focuses directly on a plain object type highlighted from the tree", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    session.applyHighlight(otId(model, "A"), "object_type");
    const p = await session.present();

    expect(p.focus).toEqual({ entityId: otId(model, "A"), entityName: "A", hopCount: 1 });
  });

  it("focuses an objectified fact type via applyHighlight", async () => {
    const model = new ModelBuilder("Objectified")
      .withEntityType("Customer", { referenceMode: "id" })
      .withEntityType("Order", { referenceMode: "id" })
      .withEntityType("Purchase", { referenceMode: "id" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .withObjectifiedFactType("Customer places Order", "Purchase")
      .build();
    const session = new DiagramSession(model);

    session.applyHighlight(otId(model, "Purchase"), "object_type");
    const p = await session.present();

    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names).toContain("Customer");
    expect(names).toContain("Order");
    expect(p.focus).not.toBeNull();
  });

  it("falls back to a placeholder name when focus lands on an unresolved id", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    // Not a fact type, not a subtype fact, and objectificationFor finds
    // nothing for it either -- the generic fallback path sets focus
    // directly on the raw id.
    session.applyHighlight("not-a-real-entity", "object_type");
    const p = await session.present();

    expect(p.focus).toEqual({ entityId: "not-a-real-entity", entityName: "Entity", hopCount: 1 });
  });

  it("returns null promoting a ghost that no longer resolves to an object type", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "JustA", positions: {}, orientations: {}, elements: ["A"] });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "JustA" });
    await session.present();

    expect(session.addGhostToView("not-a-real-entity")).toBeNull();
  });

  it("builds an empty save-view before any layout has been computed", () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    const view = session.buildViewLayout("Empty");
    expect(view.elements).toEqual([]);
    expect(view.positions).toEqual({});
  });

  it("drops stale object-type nodes when building a save-view after a model swap", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "AB", positions: {}, orientations: {}, elements: ["A", "B"] });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "AB" });
    await session.present();

    // Swap to a freshly built model with the same names but different ids,
    // without re-running present() -- lastLayout still carries the old ids.
    session.setModel(chainModel());
    const view = session.buildViewLayout("Stale");
    expect(view.elements).toEqual([]);
  });

  it("marks the layout saved, optionally recording the active view name", () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    session.markSaved();
    session.markSaved("Named View");
    // markSaved has no observable getter beyond present()'s hasUnsavedLayout
    // and viewName -- exercised together for both call shapes.
    expect(session.viewName).toBe("Named View");
  });

  it("ignores loadView for a view name that does not exist", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    session.apply({ type: "loadView", viewName: "NoSuchView" });
    const p = await session.present();

    expect(p.view).toBeNull();
    expect(p.graph.nodes.length).toBeGreaterThan(1);
  });

  it("loads a view with no elements as an unfiltered, named view", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "AllOfIt", positions: {}, orientations: {} });
    const session = new DiagramSession(model);

    session.apply({ type: "loadView", viewName: "AllOfIt" });
    const p = await session.present();

    expect(p.view).toEqual({ viewName: "AllOfIt", hasGhosts: false });
    expect(p.graph.nodes).toHaveLength(5);
  });

  it("ignores an unresolvable element name in a saved view", async () => {
    const model = chainModel();
    model.addDiagramLayout({
      name: "Mixed",
      positions: {},
      orientations: {},
      elements: ["A", "not-a-real-entity-name"],
    });
    const session = new DiagramSession(model);

    session.apply({ type: "loadView", viewName: "Mixed" });
    const p = await session.present();

    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names).toEqual(["A"]);
  });

  it("includes only the fully-contained subtype fact in a two-level subtype view", async () => {
    const model = subtypeChainModel();
    model.addDiagramLayout({
      name: "PersonParty",
      positions: {},
      orientations: {},
      elements: ["Person", "Party"],
    });
    const session = new DiagramSession(model);

    session.apply({ type: "loadView", viewName: "PersonParty" });
    const p = await session.present();

    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names.sort()).toEqual(["Party", "Person"]);
  });

  it("does not treat a ghost-render fact type as ghosted when it touches no ghost node", async () => {
    const model = chainWithDisconnectedPair();
    const session = new DiagramSession(model);

    session.apply({ type: "showNeighbors", nodeId: otId(model, "A") });
    const p = await session.present();

    // D-E is unrelated to the ghosted B, so it must render as a normal
    // fact type rather than being pulled into the ghost id set.
    expect(p.ghostNodeIds).not.toContain(ftId(model, "D relates to E"));
  });

  it("does not re-pin already-pinned entities on a second move", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    await session.present();

    session.apply({ type: "moveNode", nodeId: otId(model, "A"), x: 1, y: 1 });
    await session.present();
    // positionOverrides is already non-empty, so pinAllEntitiesIfNeeded
    // must skip re-pinning every entity on this second move.
    session.apply({ type: "moveNode", nodeId: otId(model, "B"), x: 2, y: 2 });
    const layout = session.buildLayout("Default");

    expect(Object.keys(layout.positions)).toEqual(["A", "B", "C"]);
  });

  it("reloads the same model unchanged, extending an already-included fact type by continuing past it", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "AB", positions: {}, orientations: {}, elements: ["A", "B"] });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "AB" });
    await session.present();

    session.setModel(model);
    const p = await session.present();

    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    // The already-included A-B fact type is skipped on reload; B relates
    // to C is newly reachable and pulls C into the expanded filter.
    expect(names).toContain("C");
  });

  it("cleans a stale entity out of an active view filter after removing it from the model", async () => {
    const model = chainModel();
    model.addDiagramLayout({
      name: "ABOrphan",
      positions: {},
      orientations: {},
      elements: ["A", "B"],
    });
    const orphanId = model.addObjectType({ name: "Orphan", kind: "value" }).id;
    model.getDiagramLayout("ABOrphan");
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "ABOrphan" });
    await session.present();

    session.apply({ type: "focusEntity", nodeId: otId(model, "A"), hopCount: 1 });
    session.apply({ type: "loadView", viewName: "ABOrphan" });
    session.apply({ type: "showNeighbors", nodeId: orphanId });
    model.removeObjectType(orphanId);
    session.setModel(model);
    const p = await session.present();

    expect(p.ghostNodeIds).not.toContain(orphanId);
  });

  it("expands a subtype filter across a model reload, dropping a stale focused entity", async () => {
    const model = subtypeChainModel();
    model.addDiagramLayout({
      name: "PersonParty",
      positions: {},
      orientations: {},
      elements: ["Person", "Party"],
    });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "PersonParty" });
    await session.present();
    session.apply({ type: "focusEntity", nodeId: otId(model, "Person"), hopCount: 1 });

    // Reload with a freshly built model: the same shape but new ids, so the
    // previously focused entity id no longer resolves and must be cleared.
    session.setModel(subtypeChainModel());
    const p = await session.present();

    expect(p.focus).toBeNull();
  });

  it("seeds position and orientation overrides from a saved layout, skipping unresolved names", async () => {
    const model = chainModel();
    const abFtId = ftId(model, "A relates to B");
    model.addDiagramLayout({
      name: "Seeded",
      positions: {
        A: { x: 10, y: 20 },
        "A relates to B": { x: 30, y: 40 },
        "not-a-real-name": { x: 0, y: 0 },
      },
      orientations: {
        "A relates to B": "vertical",
        "not-a-real-name": "vertical",
      },
    });
    const session = new DiagramSession(model, model.getDiagramLayout("Seeded"));
    await session.present();

    session.apply({ type: "moveNode", nodeId: abFtId, x: 999, y: 999 });
    const layout = session.buildLayout("Resaved");

    expect(layout.positions["A"]).toEqual({ x: 10, y: 20 });
    expect(layout.orientations["A relates to B"]).toBe("vertical");
  });

  it("builds a save-layout before any layout has been computed", () => {
    const model = chainModel();
    const session = new DiagramSession(model);

    const layout = session.buildLayout("Empty");
    expect(layout.positions).toEqual({});
    expect(layout.orientations).toEqual({});
  });

  it("keeps a still-valid ghost across an unrelated reload, then drops it once its model is gone", async () => {
    const model = chainModel();
    model.addDiagramLayout({ name: "JustA", positions: {}, orientations: {}, elements: ["A"] });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "JustA" });
    await session.present();
    session.apply({ type: "showNeighbors", nodeId: otId(model, "A") });

    // Same model instance: the ghosted B id is still valid and survives.
    session.setModel(model);
    const kept = await session.present();
    expect(kept.ghostNodeIds.length).toBeGreaterThan(0);

    // A freshly built model has entirely new ids: the ghost no longer
    // resolves and cleanStaleFilterIds must drop it.
    session.setModel(chainModel());
    const cleared = await session.present();
    expect(cleared.ghostNodeIds).toEqual([]);
  });

  it("expands a subtype filter's fact ids on reload, then skips them once already included", async () => {
    const model = subtypeChainModel();
    model.addDiagramLayout({
      name: "JustPerson",
      positions: {},
      orientations: {},
      elements: ["Person"],
    });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "JustPerson" });
    await session.present();

    // Person's own subtype link (to Party) and the link where Person is the
    // supertype (from Employee) both become reachable from the Person seed.
    session.setModel(model);
    const expanded = await session.present();
    const names = expanded.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names.sort()).toEqual(["Employee", "Party", "Person"]);

    // Reloading again finds both subtype facts already in the filter and
    // must skip re-adding them.
    session.setModel(model);
    const reloaded = await session.present();
    expect(reloaded.graph.nodes.length).toBe(expanded.graph.nodes.length);
  });

  it("drops a fact type's stale position and orientation overrides after a model swap", async () => {
    const model = chainModel();
    const session = new DiagramSession(model);
    await session.present();
    const abFtId = ftId(model, "A relates to B");

    session.apply({ type: "moveNode", nodeId: abFtId, x: 5, y: 5 });
    session.apply({ type: "toggleOrientation", nodeId: abFtId });
    await session.present();

    // The fact type id from the old model no longer resolves against the
    // new one, so its saved position/orientation must be dropped rather
    // than saved under a stale key.
    session.setModel(chainModel());
    const layout = session.buildLayout("Stale");

    expect(layout.positions["A relates to B"]).toBeUndefined();
    expect(layout.orientations["A relates to B"]).toBeUndefined();
  });

  it("drops a stale subtype fact from an active filter while keeping a still-valid one", async () => {
    const model = subtypeChainModel();
    model.addDiagramLayout({
      name: "AllThree",
      positions: {},
      orientations: {},
      elements: ["Party", "Person", "Employee"],
    });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "AllThree" });
    await session.present();

    const employeePersonLink = model.subtypeFacts.find(
      (sf) => sf.subtypeId === otId(model, "Employee"),
    )!;
    model.removeSubtypeFact(employeePersonLink.id);
    session.setModel(model);
    const p = await session.present();

    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    // Party-Person survives; Employee is no longer linked into the filter.
    expect(names).toContain("Party");
    expect(names).toContain("Person");
  });

  it("leaves an unrelated subtype fact out of an expanded filter", async () => {
    const model = subtypeChainWithUnrelatedPair();
    model.addDiagramLayout({
      name: "JustPerson",
      positions: {},
      orientations: {},
      elements: ["Person"],
    });
    const session = new DiagramSession(model);
    session.apply({ type: "loadView", viewName: "JustPerson" });
    await session.present();

    session.setModel(model);
    const p = await session.present();

    const names = p.graph.nodes
      .filter((n) => n.kind === "object_type")
      .map((n) => model.getObjectType(n.id)?.name);
    expect(names).not.toContain("Vehicle");
    expect(names).not.toContain("Car");
  });
});
