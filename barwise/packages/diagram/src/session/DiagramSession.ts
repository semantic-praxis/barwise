/**
 * Platform-independent interactive-diagram state.
 *
 * Owns the state a diagram editor mutates across interactions -- position
 * and orientation overrides, focus/hop filtering, named-view filters,
 * ghost neighbors -- and produces a serializable `DiagramPresentation`.
 * It has zero VS Code, browser, or filesystem dependencies, so any front
 * end (the VS Code webview today, a server tomorrow, a unit test) can
 * drive it. See `docs/specs/diagram-presentation-contract.spec.md`.
 *
 * Persistence (reading/writing the `.orm.yaml`) and the async stale-render
 * guard stay in the host adapter; this class only assembles the data.
 */
import type { DiagramLayout, OrmModel } from "@barwise/core";
import { generateDiagram } from "../DiagramGenerator.js";
import { computeNeighborhood } from "../graph/NeighborhoodFilter.js";
import type { PositionedFactTypeNode, PositionedGraph } from "../layout/LayoutTypes.js";
import type { DiagramFocus, DiagramIntent, DiagramPresentation } from "./contract.js";

interface ViewFilter {
  readonly objectTypeIds: Set<string>;
  readonly factTypeIds: Set<string>;
  readonly subtypeFactIds: Set<string>;
}

type Orientation = "horizontal" | "vertical";

export class DiagramSession {
  private model: OrmModel;
  private positionOverrides: Record<string, { x: number; y: number; }> = {};
  private orientationOverrides: Record<string, Orientation> = {};
  private hasUnsavedChanges = false;
  private focusEntityId: string | undefined;
  private hopCount: number | undefined;
  private activeViewFilter: ViewFilter | undefined;
  private activeViewName: string | undefined;
  private readonly ghostObjectTypeIds = new Set<string>();
  private lastLayout: PositionedGraph | undefined;

  constructor(model: OrmModel, savedLayout?: DiagramLayout) {
    this.model = model;
    this.seedOverridesFromSavedLayout(model, savedLayout);
  }

  /** The last positioned graph produced by `present()`, if any. */
  get layout(): PositionedGraph | undefined {
    return this.lastLayout;
  }

  /** The active named view, if a view is loaded. */
  get viewName(): string | undefined {
    return this.activeViewName;
  }

  /**
   * Hot-swap the model (live reload). Stale filter ids are pruned and an
   * active view filter is expanded to touch the new model.
   */
  setModel(model: OrmModel): void {
    this.model = model;
    this.cleanStaleFilterIds();
    this.expandFilterForNewModel();
  }

  /** Run the layout for the current state and return the presentation. */
  async present(): Promise<DiagramPresentation> {
    const includeFilter = this.buildEffectiveFilter();
    const useFocusForFilter = this.focusEntityId && !includeFilter;
    const result = await generateDiagram(this.model, {
      positionOverrides: this.positionOverrides,
      orientationOverrides: this.orientationOverrides,
      focusEntityId: useFocusForFilter ? this.focusEntityId : undefined,
      hopCount: useFocusForFilter ? this.hopCount : undefined,
      includeFilter,
    });
    this.lastLayout = result.layout;
    return this.buildPresentation(result.layout);
  }

  /**
   * Apply a front-end intent. Pure state mutation; the caller then calls
   * `present()`. Drag intents carry top-left coordinates and are converted
   * to center-based overrides using the last layout.
   */
  apply(intent: DiagramIntent): void {
    switch (intent.type) {
      case "moveNode": {
        this.pinAllEntitiesIfNeeded();
        const node = this.lastLayout?.nodes.find((n) => n.id === intent.nodeId);
        this.positionOverrides[intent.nodeId] = {
          x: intent.x + (node?.width ?? 0) / 2,
          y: intent.y + (node?.height ?? 0) / 2,
        };
        this.hasUnsavedChanges = true;
        break;
      }
      case "toggleOrientation": {
        this.pinAllEntitiesIfNeeded();
        const ftId = intent.nodeId;
        const ftNode = this.lastLayout?.nodes.find(
          (n): n is PositionedFactTypeNode => n.id === ftId && n.kind === "fact_type",
        );
        const current = this.orientationOverrides[ftId] ?? ftNode?.orientation ?? "horizontal";
        this.orientationOverrides[ftId] = current === "horizontal" ? "vertical" : "horizontal";
        this.hasUnsavedChanges = true;
        break;
      }
      case "selectElement": {
        // Selection is presentational; no session state to update.
        break;
      }
      case "focusEntity": {
        this.focusEntityId = intent.nodeId;
        this.hopCount = intent.hopCount;
        this.resetFiltersAndOverrides();
        break;
      }
      case "clearFocus": {
        this.focusEntityId = undefined;
        this.hopCount = undefined;
        this.resetFiltersAndOverrides();
        break;
      }
      case "loadView": {
        this.applyNamedView(intent.viewName);
        break;
      }
      case "showNeighbors": {
        const neighborhood = computeNeighborhood(this.model, intent.nodeId, 1);
        const viewIds = this.activeViewFilter?.objectTypeIds ?? new Set<string>();
        for (const otId of neighborhood.objectTypeIds) {
          if (!viewIds.has(otId) && otId !== intent.nodeId) {
            this.ghostObjectTypeIds.add(otId);
          }
        }
        break;
      }
      case "clearGhosts": {
        this.ghostObjectTypeIds.clear();
        break;
      }
    }
  }

  /**
   * Focus on an element from the model tree: filter to its neighborhood.
   * Dispatches on element kind exactly as the tree's "highlight" did.
   */
  applyHighlight(elementId: string, kind: string): void {
    this.activeViewFilter = undefined;
    this.activeViewName = undefined;
    this.ghostObjectTypeIds.clear();
    this.positionOverrides = {};

    if (kind === "subtype_fact") {
      const sf = this.model.subtypeFacts.find((s) => s.id === elementId);
      if (!sf) return;
      this.applySeedFilter([sf.subtypeId, sf.supertypeId], sf.subtypeId);
      return;
    }

    if (kind === "fact_type") {
      const ft = this.model.getFactType(elementId);
      if (!ft) return;
      const seeds = [...new Set(ft.roles.map((r) => r.playerId))];
      if (seeds.length === 0) return;
      this.applySeedFilter(seeds, seeds[0]!);
      return;
    }

    const objectification = this.model.objectificationFor(elementId);
    if (objectification) {
      const ft = this.model.getFactType(objectification.factTypeId);
      if (ft) {
        const seeds = [...new Set(ft.roles.map((r) => r.playerId))];
        if (seeds.length > 0) {
          this.applySeedFilter(seeds, seeds[0]!);
          return;
        }
      }
    }

    this.focusEntityId = elementId;
    this.hopCount = 1;
  }

  /**
   * Promote a ghost entity into the active view filter. Returns the
   * entity's name for the host to persist into the saved view's element
   * list, or null when there is nothing to promote.
   */
  addGhostToView(entityId: string): string | null {
    if (!this.activeViewFilter || !this.activeViewName) return null;
    const ot = this.model.getObjectType(entityId);
    if (!ot) return null;

    this.ghostObjectTypeIds.delete(entityId);
    this.activeViewFilter.objectTypeIds.add(entityId);
    this.expandFilterFromObjectTypes(this.activeViewFilter);
    return ot.name;
  }

  /** Assemble a `DiagramLayout` for the current full layout (save-layout). */
  buildLayout(name: string): DiagramLayout {
    return {
      name,
      positions: this.collectPositions(),
      orientations: this.collectOrientations(),
    };
  }

  /** Assemble a `DiagramLayout` for the current filtered view (save-view). */
  buildViewLayout(name: string): DiagramLayout {
    const elements: string[] = [];
    for (const node of this.lastLayout?.nodes ?? []) {
      if (node.kind === "object_type") {
        const ot = this.model.getObjectType(node.id);
        if (ot) elements.push(ot.name);
      }
    }
    return {
      name,
      elements,
      positions: this.collectPositions(),
      orientations: this.collectOrientations(),
    };
  }

  /** Mark the layout saved (the host has written it to disk). */
  markSaved(viewName?: string): void {
    this.hasUnsavedChanges = false;
    if (viewName !== undefined) this.activeViewName = viewName;
  }

  // -- internals ------------------------------------------------------------

  private resetFiltersAndOverrides(): void {
    this.activeViewFilter = undefined;
    this.activeViewName = undefined;
    this.ghostObjectTypeIds.clear();
    this.positionOverrides = {};
  }

  private applySeedFilter(seeds: string[], focusId: string): void {
    this.activeViewFilter = this.buildMultiEntityFilter(seeds, 1);
    this.focusEntityId = focusId;
    this.hopCount = 1;
  }

  private buildMultiEntityFilter(seeds: string[], hops: number): ViewFilter {
    const objectTypeIds = new Set<string>();
    const factTypeIds = new Set<string>();
    const subtypeFactIds = new Set<string>();
    for (const seed of seeds) {
      const n = computeNeighborhood(this.model, seed, hops);
      for (const id of n.objectTypeIds) objectTypeIds.add(id);
      for (const id of n.factTypeIds) factTypeIds.add(id);
      for (const id of n.subtypeFactIds) subtypeFactIds.add(id);
    }
    return { objectTypeIds, factTypeIds, subtypeFactIds };
  }

  private applyNamedView(viewName: string): void {
    const layout = this.model.getDiagramLayout(viewName);
    if (!layout) return;

    if (layout.elements && layout.elements.length > 0) {
      const objectTypeIds = new Set<string>();
      for (const name of layout.elements) {
        const ot = this.model.getObjectTypeByName(name);
        if (ot) objectTypeIds.add(ot.id);
      }
      const filter: ViewFilter = {
        objectTypeIds,
        factTypeIds: new Set<string>(),
        subtypeFactIds: new Set<string>(),
      };
      this.includeFullyContainedRelations(filter);
      this.activeViewFilter = filter;
      this.activeViewName = viewName;
    } else {
      this.activeViewFilter = undefined;
      this.activeViewName = viewName;
    }

    this.seedOverridesFromSavedLayout(this.model, layout);
    this.focusEntityId = undefined;
    this.hopCount = undefined;
    this.ghostObjectTypeIds.clear();
  }

  private buildEffectiveFilter(): ViewFilter | undefined {
    if (!this.activeViewFilter || this.ghostObjectTypeIds.size === 0) {
      return this.activeViewFilter;
    }
    const expanded: ViewFilter = {
      objectTypeIds: new Set(this.activeViewFilter.objectTypeIds),
      factTypeIds: new Set(this.activeViewFilter.factTypeIds),
      subtypeFactIds: new Set(this.activeViewFilter.subtypeFactIds),
    };
    for (const id of this.ghostObjectTypeIds) expanded.objectTypeIds.add(id);
    this.includeFullyContainedRelations(expanded);
    return expanded;
  }

  /** Add fact/subtype relations whose every player is already included. */
  private includeFullyContainedRelations(filter: ViewFilter): void {
    for (const ft of this.model.factTypes) {
      if (ft.roles.every((r) => filter.objectTypeIds.has(r.playerId))) {
        filter.factTypeIds.add(ft.id);
      }
    }
    for (const sf of this.model.subtypeFacts) {
      if (filter.objectTypeIds.has(sf.subtypeId) && filter.objectTypeIds.has(sf.supertypeId)) {
        filter.subtypeFactIds.add(sf.id);
      }
    }
  }

  /** addGhostToView's expansion: same as named-view containment. */
  private expandFilterFromObjectTypes(filter: ViewFilter): void {
    this.includeFullyContainedRelations(filter);
  }

  private computeGhostRenderIds(): readonly string[] {
    if (this.ghostObjectTypeIds.size === 0) return [];
    const ids = new Set(this.ghostObjectTypeIds);
    for (const ft of this.model.factTypes) {
      if (ft.roles.some((r) => this.ghostObjectTypeIds.has(r.playerId))) {
        ids.add(ft.id);
      }
    }
    return [...ids];
  }

  private pinAllEntitiesIfNeeded(): void {
    if (Object.keys(this.positionOverrides).length === 0 && this.lastLayout) {
      for (const node of this.lastLayout.nodes) {
        if (node.kind === "object_type") {
          this.positionOverrides[node.id] = {
            x: node.x + node.width / 2,
            y: node.y + node.height / 2,
          };
        }
      }
    }
  }

  private cleanStaleFilterIds(): void {
    const validOtIds = new Set(this.model.objectTypes.map((ot) => ot.id));
    const validFtIds = new Set(this.model.factTypes.map((ft) => ft.id));
    const validSfIds = new Set(this.model.subtypeFacts.map((sf) => sf.id));

    if (this.activeViewFilter) {
      for (const id of this.activeViewFilter.objectTypeIds) {
        if (!validOtIds.has(id)) this.activeViewFilter.objectTypeIds.delete(id);
      }
      for (const id of this.activeViewFilter.factTypeIds) {
        if (!validFtIds.has(id)) this.activeViewFilter.factTypeIds.delete(id);
      }
      for (const id of this.activeViewFilter.subtypeFactIds) {
        if (!validSfIds.has(id)) this.activeViewFilter.subtypeFactIds.delete(id);
      }
    }
    for (const id of this.ghostObjectTypeIds) {
      if (!validOtIds.has(id)) this.ghostObjectTypeIds.delete(id);
    }
    if (this.focusEntityId && !validOtIds.has(this.focusEntityId)) {
      this.focusEntityId = undefined;
      this.hopCount = undefined;
    }
  }

  private expandFilterForNewModel(): void {
    if (!this.activeViewFilter) return;
    const { objectTypeIds, factTypeIds, subtypeFactIds } = this.activeViewFilter;
    const seedIds = new Set(objectTypeIds);

    for (const ft of this.model.factTypes) {
      if (factTypeIds.has(ft.id)) continue;
      if (ft.roles.some((r) => seedIds.has(r.playerId))) {
        factTypeIds.add(ft.id);
        for (const r of ft.roles) objectTypeIds.add(r.playerId);
      }
    }
    for (const sf of this.model.subtypeFacts) {
      if (subtypeFactIds.has(sf.id)) continue;
      if (seedIds.has(sf.subtypeId) || seedIds.has(sf.supertypeId)) {
        subtypeFactIds.add(sf.id);
        objectTypeIds.add(sf.subtypeId);
        objectTypeIds.add(sf.supertypeId);
      }
    }
  }

  private seedOverridesFromSavedLayout(model: OrmModel, saved?: DiagramLayout): void {
    this.positionOverrides = {};
    this.orientationOverrides = {};
    this.hasUnsavedChanges = false;
    if (!saved) return;

    for (const [name, pos] of Object.entries(saved.positions)) {
      const ot = model.getObjectTypeByName(name);
      if (ot) {
        this.positionOverrides[ot.id] = { x: pos.x, y: pos.y };
      } else {
        const ft = model.getFactTypeByName(name);
        if (ft) this.positionOverrides[ft.id] = { x: pos.x, y: pos.y };
      }
    }
    for (const [name, ori] of Object.entries(saved.orientations)) {
      const ft = model.getFactTypeByName(name);
      if (ft) this.orientationOverrides[ft.id] = ori;
    }
  }

  private collectPositions(): Record<string, { x: number; y: number; }> {
    const positions: Record<string, { x: number; y: number; }> = {};
    for (const node of this.lastLayout?.nodes ?? []) {
      if (node.kind === "object_type") {
        const ot = this.model.getObjectType(node.id);
        if (ot) positions[ot.name] = this.centerOf(node);
      } else if (node.kind === "fact_type" && this.positionOverrides[node.id]) {
        const ft = this.model.getFactType(node.id);
        if (ft) positions[ft.name] = this.centerOf(node);
      }
    }
    return this.sortKeys(positions);
  }

  private collectOrientations(): Record<string, Orientation> {
    const orientations: Record<string, Orientation> = {};
    for (const [ftId, ori] of Object.entries(this.orientationOverrides)) {
      const ft = this.model.getFactType(ftId);
      if (ft) orientations[ft.name] = ori;
    }
    return this.sortKeys(orientations);
  }

  private centerOf(node: { x: number; y: number; width: number; height: number; }): {
    x: number;
    y: number;
  } {
    return {
      x: Math.round(node.x + node.width / 2),
      y: Math.round(node.y + node.height / 2),
    };
  }

  private sortKeys<T>(obj: Record<string, T>): Record<string, T> {
    const sorted: Record<string, T> = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = obj[key]!;
    return sorted;
  }

  private buildPresentation(graph: PositionedGraph): DiagramPresentation {
    return {
      graph,
      ghostNodeIds: this.computeGhostRenderIds(),
      focus: this.buildFocus(),
      view: this.activeViewName
        ? { viewName: this.activeViewName, hasGhosts: this.ghostObjectTypeIds.size > 0 }
        : null,
      availableViews: this.model.diagramLayouts.map((d) => d.name),
      hasUnsavedLayout: this.hasUnsavedChanges,
      modelName: this.model.name,
    };
  }

  private buildFocus(): DiagramFocus | null {
    if (!this.focusEntityId) return null;
    const ot = this.model.getObjectType(this.focusEntityId);
    return {
      entityId: this.focusEntityId,
      entityName: ot?.name ?? "Entity",
      hopCount: this.hopCount ?? 1,
    };
  }
}
