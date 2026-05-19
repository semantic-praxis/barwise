import { type DiagramLayout, type OrmModel, OrmYamlSerializer } from "@barwise/core";
import {
  computeNeighborhood,
  generateDiagram,
  type OrientationOverrides,
  type PositionedGraph,
  type PositionOverrides,
} from "@barwise/diagram";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { DiagramMeta, OutboundMessage } from "./protocol.js";

const saveSerializer = new OrmYamlSerializer();

/**
 * Hosts the ORM diagram webview.
 *
 * The webview runs a React application (built to `dist/webview/`). The
 * panel runs `@barwise/diagram` host-side and pushes the resulting
 * `PositionedGraph` to the React app over the typed message protocol in
 * `protocol.ts`; the React app renders it and reports interaction back.
 */
export class DiagramPanel {
  private static currentPanel: DiagramPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposed = false;
  private webviewReady = false;
  private model: OrmModel | undefined;
  private filePath: string | undefined;
  private currentLayout: PositionedGraph | undefined;
  private positionOverrides: Record<string, { x: number; y: number; }> = {};
  private orientationOverrides: Record<string, "horizontal" | "vertical"> = {};
  private hasUnsavedChanges = false;
  private focusEntityId: string | undefined;
  private hopCount: number | undefined;
  private activeViewFilter: {
    objectTypeIds: Set<string>;
    factTypeIds: Set<string>;
    subtypeFactIds: Set<string>;
  } | undefined;
  private activeViewName: string | undefined;
  private ghostObjectTypeIds = new Set<string>();
  private renderVersion = 0;
  private docChangeDisposable: vscode.Disposable | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    fileName: string,
    model?: OrmModel,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.model = model;
    this.filePath = fileName;
    this.setTitle(fileName);
    this.panel.webview.html = this.buildHtml();

    this.setupDocumentWatcher();

    this.panel.onDidDispose(() => {
      this.disposed = true;
      if (this.refreshTimer) {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = undefined;
      }
      this.docChangeDisposable?.dispose();
      this.docChangeDisposable = undefined;
      DiagramPanel.currentPanel = undefined;
    });

    this.panel.webview.onDidReceiveMessage((message: OutboundMessage) => {
      this.handleMessage(message);
    });
  }

  /**
   * Handle a typed message from the webview.
   */
  private handleMessage(message: OutboundMessage): void {
    switch (message.type) {
      case "ready": {
        this.webviewReady = true;
        this.postGraph(true);
        break;
      }
      case "nodeMoved": {
        if (!this.model) break;
        this.pinAllEntitiesIfNeeded();
        // Convert top-left (from the drag) to center coordinates so
        // overrides stay center-based throughout the pipeline.
        const draggedNode = this.currentLayout?.nodes.find(
          (n) => n.id === message.nodeId,
        );
        this.positionOverrides[message.nodeId] = {
          x: message.x + (draggedNode?.width ?? 0) / 2,
          y: message.y + (draggedNode?.height ?? 0) / 2,
        };
        this.hasUnsavedChanges = true;
        void this.rerender(false);
        break;
      }
      case "toggleOrientation": {
        if (!this.model) break;
        this.pinAllEntitiesIfNeeded();
        const ftId = message.nodeId;
        const current = this.orientationOverrides[ftId];
        const ftNode = this.currentLayout?.nodes.find(
          (n): n is import("@barwise/diagram").PositionedFactTypeNode =>
            n.id === ftId && n.kind === "fact_type",
        );
        const layoutOrientation = ftNode?.orientation ?? "horizontal";
        const effectiveCurrent = current ?? layoutOrientation;
        this.orientationOverrides[ftId] = effectiveCurrent === "horizontal"
          ? "vertical"
          : "horizontal";
        this.hasUnsavedChanges = true;
        void this.rerender(false);
        break;
      }
      case "saveLayout": {
        void this.saveLayout();
        break;
      }
      case "saveView": {
        void this.saveView();
        break;
      }
      case "loadView": {
        this.applyNamedView(message.viewName);
        break;
      }
      case "selectElement": {
        // Selection is presentational; no host state to update yet.
        break;
      }
      case "focusEntity": {
        this.focusEntityId = message.nodeId;
        this.hopCount = message.hopCount;
        this.activeViewFilter = undefined;
        this.activeViewName = undefined;
        this.ghostObjectTypeIds.clear();
        this.positionOverrides = {};
        void this.rerender(true);
        break;
      }
      case "clearFocus": {
        this.focusEntityId = undefined;
        this.hopCount = undefined;
        this.activeViewFilter = undefined;
        this.activeViewName = undefined;
        this.ghostObjectTypeIds.clear();
        this.positionOverrides = {};
        void this.rerender(true);
        break;
      }
      case "showNeighbors": {
        if (!this.model) break;
        const neighborhood = computeNeighborhood(this.model, message.nodeId, 1);
        const viewIds = this.activeViewFilter?.objectTypeIds ?? new Set<string>();
        for (const otId of neighborhood.objectTypeIds) {
          if (!viewIds.has(otId) && otId !== message.nodeId) {
            this.ghostObjectTypeIds.add(otId);
          }
        }
        void this.rerender(false);
        break;
      }
      case "addGhostToView": {
        if (!this.model) break;
        void this.addGhostToView(message.nodeId);
        break;
      }
      case "clearGhosts": {
        this.ghostObjectTypeIds.clear();
        void this.rerender(false);
        break;
      }
    }
  }

  /**
   * Watch the backing .orm.yaml document for changes and auto-refresh
   * the diagram. When the file is edited, the model is re-parsed and the
   * diagram re-rendered. An active view filter is expanded to include
   * new fact types / entities that touch the displayed submodel.
   */
  private setupDocumentWatcher(): void {
    this.docChangeDisposable = vscode.workspace.onDidChangeTextDocument((e) => {
      if (this.disposed || !this.filePath) return;
      if (e.document.uri.fsPath !== this.filePath) return;
      // Debounce: only refresh once the user pauses typing.
      if (this.refreshTimer) clearTimeout(this.refreshTimer);
      this.refreshTimer = setTimeout(() => {
        this.refreshTimer = undefined;
        this.refreshFromDocument(e.document.getText());
      }, 300);
    });
  }

  /**
   * Re-parse the backing document and re-render. Silently ignores parse
   * errors (the user may still be typing).
   */
  private refreshFromDocument(text: string): void {
    if (this.disposed) return;
    let newModel: OrmModel;
    try {
      newModel = saveSerializer.deserialize(text);
    } catch {
      return;
    }
    this.model = newModel;
    this.cleanStaleFilterIds();
    this.expandFilterForNewModel();
    void this.rerender(false);
  }

  /**
   * Remove IDs from the active view filter that no longer exist in the
   * current model. Also clears focus if the focused entity is gone.
   */
  private cleanStaleFilterIds(): void {
    if (!this.model) return;

    const validOtIds = new Set(this.model.objectTypes.map((ot) => ot.id));
    const validFtIds = new Set(this.model.factTypes.map((ft) => ft.id));
    const validSfIds = new Set(this.model.subtypeFacts.map((sf) => sf.id));

    if (this.activeViewFilter) {
      for (const id of [...this.activeViewFilter.objectTypeIds]) {
        if (!validOtIds.has(id)) this.activeViewFilter.objectTypeIds.delete(id);
      }
      for (const id of [...this.activeViewFilter.factTypeIds]) {
        if (!validFtIds.has(id)) this.activeViewFilter.factTypeIds.delete(id);
      }
      for (const id of [...this.activeViewFilter.subtypeFactIds]) {
        if (!validSfIds.has(id)) {
          this.activeViewFilter.subtypeFactIds.delete(id);
        }
      }
    }

    for (const id of [...this.ghostObjectTypeIds]) {
      if (!validOtIds.has(id)) this.ghostObjectTypeIds.delete(id);
    }

    if (this.focusEntityId && !validOtIds.has(this.focusEntityId)) {
      this.focusEntityId = undefined;
      this.hopCount = undefined;
    }
  }

  /**
   * Expand the active view filter by one hop from currently displayed
   * entities: any new fact type whose roles touch a visible entity is
   * added, along with its new role players.
   */
  private expandFilterForNewModel(): void {
    if (!this.model || !this.activeViewFilter) return;
    const { objectTypeIds, factTypeIds, subtypeFactIds } = this.activeViewFilter;

    const seedIds = new Set(objectTypeIds);

    for (const ft of this.model.factTypes) {
      if (factTypeIds.has(ft.id)) continue;
      if (ft.roles.some((r) => seedIds.has(r.playerId))) {
        factTypeIds.add(ft.id);
        for (const r of ft.roles) {
          objectTypeIds.add(r.playerId);
        }
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

  /**
   * On first interaction, pin all entities at their current layout
   * positions so only the interacted element changes.
   */
  private pinAllEntitiesIfNeeded(): void {
    if (
      Object.keys(this.positionOverrides).length === 0
      && this.currentLayout
    ) {
      for (const node of this.currentLayout.nodes) {
        if (node.kind === "object_type") {
          this.positionOverrides[node.id] = {
            x: node.x + node.width / 2,
            y: node.y + node.height / 2,
          };
        }
      }
    }
  }

  /**
   * Create a new panel or reveal the existing one with updated content.
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    fileName: string,
    model?: OrmModel,
    layout?: PositionedGraph,
    savedLayout?: DiagramLayout,
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (DiagramPanel.currentPanel) {
      const existing = DiagramPanel.currentPanel;
      existing.panel.reveal(column);
      existing.model = model;
      existing.filePath = fileName;
      existing.currentLayout = layout;
      existing.setTitle(fileName);
      if (model) {
        existing.seedOverridesFromSavedLayout(model, savedLayout);
      }
      existing.postGraph(true);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      "ormDiagram",
      "Barwise Diagram",
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri],
      },
    );

    const dp = new DiagramPanel(panel, extensionUri, fileName, model);
    dp.currentLayout = layout;
    if (model) {
      dp.seedOverridesFromSavedLayout(model, savedLayout);
    }
    DiagramPanel.currentPanel = dp;
  }

  /**
   * Seed position/orientation overrides from a saved DiagramLayout so
   * subsequent drags only move the dragged entity (others are pinned).
   */
  private seedOverridesFromSavedLayout(
    model: OrmModel,
    saved?: DiagramLayout,
  ): void {
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
        if (ft) {
          this.positionOverrides[ft.id] = { x: pos.x, y: pos.y };
        }
      }
    }

    for (const [name, ori] of Object.entries(saved.orientations)) {
      const ft = model.getFactTypeByName(name);
      if (ft) {
        this.orientationOverrides[ft.id] = ori;
      }
    }
  }

  /**
   * Focus on an element in the diagram: filter to its neighborhood.
   */
  static highlightElement(elementId: string, kind: string): void {
    const panel = DiagramPanel.currentPanel;
    if (!panel || panel.disposed || !panel.model) return;

    panel.activeViewFilter = undefined;
    panel.activeViewName = undefined;
    panel.ghostObjectTypeIds.clear();
    panel.positionOverrides = {};

    if (kind === "subtype_fact") {
      const sf = panel.model.subtypeFacts.find((s) => s.id === elementId);
      if (!sf) return;
      const seeds = [sf.subtypeId, sf.supertypeId];
      const filter = DiagramPanel.buildMultiEntityFilter(panel.model, seeds, 1);
      panel.focusEntityId = sf.subtypeId;
      panel.hopCount = 1;
      panel.activeViewFilter = filter;
      void panel.rerender(true);
      return;
    }

    if (kind === "fact_type") {
      const ft = panel.model.getFactType(elementId);
      if (!ft) return;
      const seeds = [...new Set(ft.roles.map((r) => r.playerId))];
      if (seeds.length === 0) return;
      const filter = DiagramPanel.buildMultiEntityFilter(panel.model, seeds, 1);
      panel.focusEntityId = seeds[0]!;
      panel.hopCount = 1;
      panel.activeViewFilter = filter;
      void panel.rerender(true);
      return;
    }

    const objectification = panel.model.objectificationFor(elementId);
    if (objectification) {
      const ft = panel.model.getFactType(objectification.factTypeId);
      if (ft) {
        const seeds = [...new Set(ft.roles.map((r) => r.playerId))];
        if (seeds.length > 0) {
          const filter = DiagramPanel.buildMultiEntityFilter(panel.model, seeds, 1);
          panel.focusEntityId = seeds[0]!;
          panel.hopCount = 1;
          panel.activeViewFilter = filter;
          void panel.rerender(true);
          return;
        }
      }
    }

    panel.focusEntityId = elementId;
    panel.hopCount = 1;
    void panel.rerender(true);
  }

  /**
   * Build an include filter from multiple seed entities, each expanded
   * by N hops. Returns the union of all neighborhoods.
   */
  private static buildMultiEntityFilter(
    model: OrmModel,
    seeds: string[],
    hops: number,
  ): { objectTypeIds: Set<string>; factTypeIds: Set<string>; subtypeFactIds: Set<string>; } {
    const objectTypeIds = new Set<string>();
    const factTypeIds = new Set<string>();
    const subtypeFactIds = new Set<string>();

    for (const seed of seeds) {
      const n = computeNeighborhood(model, seed, hops);
      for (const id of n.objectTypeIds) objectTypeIds.add(id);
      for (const id of n.factTypeIds) factTypeIds.add(id);
      for (const id of n.subtypeFactIds) subtypeFactIds.add(id);
    }

    return { objectTypeIds, factTypeIds, subtypeFactIds };
  }

  /**
   * Load a saved diagram view by name (native-tree / command entry
   * point).
   */
  static loadView(viewName: string): void {
    DiagramPanel.currentPanel?.applyNamedView(viewName);
  }

  /**
   * Apply a saved diagram view by name: filter to its elements, seed
   * overrides from its layout, and clear any active focus / ghosts.
   * Shared by the native command and the webview `loadView` message.
   */
  private applyNamedView(viewName: string): void {
    if (this.disposed || !this.model) return;
    const layout = this.model.getDiagramLayout(viewName);
    if (!layout) return;

    if (layout.elements && layout.elements.length > 0) {
      const objectTypeIds = new Set<string>();
      const factTypeIds = new Set<string>();
      const subtypeFactIds = new Set<string>();

      for (const name of layout.elements) {
        const ot = this.model.getObjectTypeByName(name);
        if (ot) objectTypeIds.add(ot.id);
      }

      for (const ft of this.model.factTypes) {
        const allPlayersIncluded = ft.roles.every((r) => objectTypeIds.has(r.playerId));
        if (allPlayersIncluded) factTypeIds.add(ft.id);
      }

      for (const sf of this.model.subtypeFacts) {
        if (objectTypeIds.has(sf.subtypeId) && objectTypeIds.has(sf.supertypeId)) {
          subtypeFactIds.add(sf.id);
        }
      }

      this.activeViewFilter = { objectTypeIds, factTypeIds, subtypeFactIds };
      this.activeViewName = viewName;
    } else {
      this.activeViewFilter = undefined;
      this.activeViewName = viewName;
    }

    this.seedOverridesFromSavedLayout(this.model, layout);

    this.focusEntityId = undefined;
    this.hopCount = undefined;
    this.ghostObjectTypeIds.clear();

    void this.rerender(true);
  }

  /**
   * Clear any active highlighting in the diagram.
   */
  static clearHighlight(): void {
    const panel = DiagramPanel.currentPanel;
    if (!panel || panel.disposed) return;
    void panel.panel.webview.postMessage({ type: "clearHighlight" });
  }

  private setTitle(fileName: string): void {
    if (this.disposed) return;
    const baseName = path.basename(fileName, ".orm.yaml");
    this.panel.title = `Diagram: ${baseName}`;
  }

  private buildFocusState(): DiagramMeta["focus"] {
    if (!this.focusEntityId || !this.model) return null;
    const ot = this.model.getObjectType(this.focusEntityId);
    return {
      entityId: this.focusEntityId,
      entityName: ot?.name ?? "Entity",
      hopCount: this.hopCount ?? 1,
    };
  }

  private buildMeta(): DiagramMeta {
    const baseName = this.filePath
      ? path.basename(this.filePath)
      : "model.orm.yaml";
    return {
      fileName: baseName,
      modelName: this.model?.name ?? path.basename(baseName, ".orm.yaml"),
      hasUnsavedChanges: this.hasUnsavedChanges,
      focus: this.buildFocusState(),
      view: this.activeViewName
        ? { viewName: this.activeViewName, hasGhosts: this.ghostObjectTypeIds.size > 0 }
        : null,
      availableViews: this.model?.diagramLayouts.map((d) => d.name) ?? [],
    };
  }

  /**
   * Push the current positioned graph to the webview.
   */
  private postGraph(resetView: boolean): void {
    if (this.disposed || !this.webviewReady || !this.currentLayout) return;
    const ghostNodeIds = [...(this.computeGhostRenderIds() ?? [])];
    void this.panel.webview.postMessage({
      type: "setGraph",
      graph: this.currentLayout,
      ghostNodeIds,
      meta: this.buildMeta(),
      resetView,
    });
  }

  /**
   * Re-generate the diagram with current overrides and push it.
   */
  private async rerender(resetView: boolean): Promise<void> {
    if (!this.model || this.disposed) return;
    const version = ++this.renderVersion;
    try {
      const posOverrides: PositionOverrides = this.positionOverrides;
      const oriOverrides: OrientationOverrides = this.orientationOverrides;

      let includeFilter = this.activeViewFilter;
      if (this.activeViewFilter && this.ghostObjectTypeIds.size > 0) {
        const expandedOtIds = new Set(this.activeViewFilter.objectTypeIds);
        for (const id of this.ghostObjectTypeIds) expandedOtIds.add(id);

        const expandedFtIds = new Set(this.activeViewFilter.factTypeIds);
        for (const ft of this.model.factTypes) {
          const allPlayersIncluded = ft.roles.every((r) => expandedOtIds.has(r.playerId));
          if (allPlayersIncluded) expandedFtIds.add(ft.id);
        }

        const expandedStIds = new Set(this.activeViewFilter.subtypeFactIds);
        for (const sf of this.model.subtypeFacts) {
          if (expandedOtIds.has(sf.subtypeId) && expandedOtIds.has(sf.supertypeId)) {
            expandedStIds.add(sf.id);
          }
        }

        includeFilter = {
          objectTypeIds: expandedOtIds,
          factTypeIds: expandedFtIds,
          subtypeFactIds: expandedStIds,
        };
      }

      const useFocusForFilter = this.focusEntityId && !includeFilter;
      const result = await generateDiagram(this.model, {
        positionOverrides: posOverrides,
        orientationOverrides: oriOverrides,
        focusEntityId: useFocusForFilter ? this.focusEntityId : undefined,
        hopCount: useFocusForFilter ? this.hopCount : undefined,
        includeFilter,
      });

      // Skip if a newer render was started while we were awaiting.
      if (version !== this.renderVersion) return;

      this.currentLayout = result.layout;
      this.postGraph(resetView);
    } catch (err) {
      if (version === this.renderVersion) {
        console.error("Diagram rerender failed:", err);
      }
    }
  }

  /**
   * Save the current diagram layout back to the .orm.yaml `diagrams`
   * section.
   */
  private async saveLayout(): Promise<void> {
    if (!this.model || !this.filePath || !this.currentLayout) return;

    const positions: Record<string, { x: number; y: number; }> = {};
    for (const node of this.currentLayout.nodes) {
      if (node.kind === "object_type") {
        const ot = this.model.getObjectType(node.id);
        if (ot) {
          positions[ot.name] = {
            x: Math.round(node.x + node.width / 2),
            y: Math.round(node.y + node.height / 2),
          };
        }
      } else if (node.kind === "fact_type" && this.positionOverrides[node.id]) {
        const ft = this.model.getFactType(node.id);
        if (ft) {
          positions[ft.name] = {
            x: Math.round(node.x + node.width / 2),
            y: Math.round(node.y + node.height / 2),
          };
        }
      }
    }

    const orientations: Record<string, "horizontal" | "vertical"> = {};
    for (const [ftId, ori] of Object.entries(this.orientationOverrides)) {
      const ft = this.model.getFactType(ftId);
      if (ft) {
        orientations[ft.name] = ori;
      }
    }

    const sortedPositions: Record<string, { x: number; y: number; }> = {};
    for (const key of Object.keys(positions).sort()) {
      sortedPositions[key] = positions[key]!;
    }
    const sortedOrientations: Record<string, "horizontal" | "vertical"> = {};
    for (const key of Object.keys(orientations).sort()) {
      sortedOrientations[key] = orientations[key]!;
    }

    const layoutName = this.activeViewName ?? "Default";
    const layout: DiagramLayout = {
      name: layoutName,
      positions: sortedPositions,
      orientations: sortedOrientations,
    };

    try {
      const fileContent = fs.readFileSync(this.filePath, "utf-8");
      const freshModel = saveSerializer.deserialize(fileContent);

      const existing = freshModel.getDiagramLayout(layoutName);
      if (existing) {
        freshModel.updateDiagramLayout({ ...layout, elements: existing.elements });
      } else {
        freshModel.addDiagramLayout(layout);
      }

      const yaml = saveSerializer.serialize(freshModel);
      fs.writeFileSync(this.filePath, yaml, "utf-8");
      this.hasUnsavedChanges = false;
      this.postGraph(false);
      vscode.window.showInformationMessage("Diagram layout saved.");
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to save diagram layout: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Save the current filtered view as a named diagram view.
   */
  private async saveView(): Promise<void> {
    if (!this.model || !this.filePath || !this.currentLayout) return;

    const focusEntity = this.focusEntityId
      ? this.model.getObjectType(this.focusEntityId)
      : undefined;
    const defaultName = focusEntity
      ? `${focusEntity.name} (${this.hopCount ?? 1}-hop)`
      : "New View";

    const name = await vscode.window.showInputBox({
      prompt: "Name for this diagram view",
      value: defaultName,
    });
    if (!name) return;

    const elements: string[] = [];
    for (const node of this.currentLayout.nodes) {
      if (node.kind === "object_type") {
        const ot = this.model.getObjectType(node.id);
        if (ot) elements.push(ot.name);
      }
    }

    const positions: Record<string, { x: number; y: number; }> = {};
    for (const node of this.currentLayout.nodes) {
      if (node.kind === "object_type") {
        const ot = this.model.getObjectType(node.id);
        if (ot) {
          positions[ot.name] = {
            x: Math.round(node.x + node.width / 2),
            y: Math.round(node.y + node.height / 2),
          };
        }
      } else if (node.kind === "fact_type" && this.positionOverrides[node.id]) {
        const ft = this.model.getFactType(node.id);
        if (ft) {
          positions[ft.name] = {
            x: Math.round(node.x + node.width / 2),
            y: Math.round(node.y + node.height / 2),
          };
        }
      }
    }

    const orientations: Record<string, "horizontal" | "vertical"> = {};
    for (const [ftId, ori] of Object.entries(this.orientationOverrides)) {
      const ft = this.model.getFactType(ftId);
      if (ft) orientations[ft.name] = ori;
    }

    try {
      const fileContent = fs.readFileSync(this.filePath, "utf-8");
      const freshModel = saveSerializer.deserialize(fileContent);

      const existing = freshModel.getDiagramLayout(name);
      if (existing) {
        freshModel.updateDiagramLayout({ name, elements, positions, orientations });
      } else {
        freshModel.addDiagramLayout({ name, elements, positions, orientations });
      }

      const yaml = saveSerializer.serialize(freshModel);
      fs.writeFileSync(this.filePath, yaml, "utf-8");
      this.activeViewName = name;
      this.postGraph(false);
      vscode.window.showInformationMessage(`View "${name}" saved.`);
    } catch (err) {
      vscode.window.showErrorMessage(
        `Failed to save view: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Move a ghost entity into the active view permanently and persist.
   */
  private async addGhostToView(entityId: string): Promise<void> {
    if (!this.model || !this.filePath || !this.activeViewFilter || !this.activeViewName) return;

    const ot = this.model.getObjectType(entityId);
    if (!ot) return;

    this.ghostObjectTypeIds.delete(entityId);
    this.activeViewFilter.objectTypeIds.add(entityId);

    for (const ft of this.model.factTypes) {
      const allPlayersIncluded = ft.roles.every((r) =>
        this.activeViewFilter!.objectTypeIds.has(r.playerId)
      );
      if (allPlayersIncluded) this.activeViewFilter.factTypeIds.add(ft.id);
    }

    for (const sf of this.model.subtypeFacts) {
      if (
        this.activeViewFilter.objectTypeIds.has(sf.subtypeId)
        && this.activeViewFilter.objectTypeIds.has(sf.supertypeId)
      ) {
        this.activeViewFilter.subtypeFactIds.add(sf.id);
      }
    }

    try {
      const fileContent = fs.readFileSync(this.filePath, "utf-8");
      const freshModel = saveSerializer.deserialize(fileContent);
      const layout = freshModel.getDiagramLayout(this.activeViewName);
      if (layout) {
        const elements = layout.elements ? [...layout.elements] : [];
        if (!elements.includes(ot.name)) {
          elements.push(ot.name);
        }
        freshModel.updateDiagramLayout({ ...layout, elements });
        const yaml = saveSerializer.serialize(freshModel);
        fs.writeFileSync(this.filePath, yaml, "utf-8");
      }
    } catch {
      // Non-critical: the view still works in memory.
    }

    vscode.window.showInformationMessage(
      `Added "${ot.name}" to "${this.activeViewName}".`,
    );
    void this.rerender(false);
  }

  /**
   * Compute the set of ghost node IDs, including ghost object types and
   * the fact types that connect to them.
   */
  private computeGhostRenderIds(): Set<string> | undefined {
    if (this.ghostObjectTypeIds.size === 0) return undefined;
    if (!this.model) return undefined;

    const ghostRenderIds = new Set(this.ghostObjectTypeIds);
    for (const ft of this.model.factTypes) {
      if (ft.roles.some((r) => this.ghostObjectTypeIds.has(r.playerId))) {
        ghostRenderIds.add(ft.id);
      }
    }
    return ghostRenderIds;
  }

  /**
   * Build the HTML shell that loads the React webview bundle.
   */
  private buildHtml(): string {
    const webview = this.panel.webview;
    const nonce = makeNonce();
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", "main.css"),
    );
    const csp = [
      `default-src 'none'`,
      `style-src ${webview.cspSource}`,
      `img-src ${webview.cspSource} data:`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join("; ");
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <link rel="stylesheet" href="${styleUri}">
  <title>Barwise Diagram</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";
  for (let i = 0; i < 32; i++) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return nonce;
}
