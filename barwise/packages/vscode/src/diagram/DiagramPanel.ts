import { type DiagramLayout, type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { type DiagramPresentation, DiagramSession } from "@barwise/diagram";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import type { DiagramMeta, OutboundMessage } from "./protocol.js";

const saveSerializer = new OrmYamlSerializer();

/**
 * Hosts the ORM diagram webview -- a thin VS Code adapter over a
 * `DiagramSession`.
 *
 * All diagram domain logic (layout, focus/hop filtering, named views,
 * ghost neighbors, save-layout assembly) lives in the platform-independent
 * `DiagramSession` in `@barwise/diagram`. This panel owns only VS Code
 * concerns: hosting the webview, watching the document, translating
 * webview messages into `DiagramSession` intents and posting the resulting
 * presentation back, and the file I/O for save-layout / save-view. See
 * `docs/specs/diagram-presentation-contract.spec.md`.
 */
export class DiagramPanel {
  private static currentPanel: DiagramPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly extensionUri: vscode.Uri;
  private disposed = false;
  private webviewReady = false;
  private session: DiagramSession;
  private filePath: string | undefined;
  private lastPresentation: DiagramPresentation | undefined;
  /** Guards against an older async render overwriting a newer one. */
  private renderVersion = 0;
  private docChangeDisposable: vscode.Disposable | undefined;
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    fileName: string,
    model: OrmModel,
    savedLayout?: DiagramLayout,
  ) {
    this.panel = panel;
    this.extensionUri = extensionUri;
    this.filePath = fileName;
    this.session = new DiagramSession(model, savedLayout);
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

    void this.rerender(true);
  }

  /**
   * Create a new panel or reveal the existing one with a fresh session.
   */
  static createOrShow(
    extensionUri: vscode.Uri,
    fileName: string,
    model: OrmModel,
    savedLayout?: DiagramLayout,
  ): void {
    const column = vscode.ViewColumn.Beside;

    if (DiagramPanel.currentPanel) {
      const existing = DiagramPanel.currentPanel;
      existing.panel.reveal(column);
      existing.filePath = fileName;
      existing.session = new DiagramSession(model, savedLayout);
      existing.lastPresentation = undefined;
      existing.setTitle(fileName);
      void existing.rerender(true);
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

    DiagramPanel.currentPanel = new DiagramPanel(
      panel,
      extensionUri,
      fileName,
      model,
      savedLayout,
    );
  }

  /**
   * The file path of the model shown in the open diagram panel, or
   * undefined if no diagram is open. Lets the barwise tools resolve a
   * source when the diagram webview -- not a text editor -- is focused.
   */
  static activeModelPath(): string | undefined {
    return DiagramPanel.currentPanel?.filePath;
  }

  /**
   * Focus on an element from the model tree: filter to its neighborhood.
   */
  static highlightElement(elementId: string, kind: string): void {
    const panel = DiagramPanel.currentPanel;
    if (!panel || panel.disposed) return;
    panel.session.applyHighlight(elementId, kind);
    void panel.rerender(true);
  }

  /**
   * Load a saved diagram view by name (native-tree / command entry point).
   */
  static loadView(viewName: string): void {
    const panel = DiagramPanel.currentPanel;
    if (!panel || panel.disposed) return;
    panel.session.apply({ type: "loadView", viewName });
    void panel.rerender(true);
  }

  /**
   * Clear any active highlighting in the diagram.
   */
  static clearHighlight(): void {
    const panel = DiagramPanel.currentPanel;
    if (!panel || panel.disposed) return;
    void panel.panel.webview.postMessage({ type: "clearHighlight" });
  }

  /** Translate a webview message into a session intent or host action. */
  private handleMessage(message: OutboundMessage): void {
    if (message.type === "ready") {
      this.webviewReady = true;
      this.postGraph(true);
      return;
    }

    switch (message.type) {
      case "nodeMoved":
        this.session.apply({
          type: "moveNode",
          nodeId: message.nodeId,
          x: message.x,
          y: message.y,
        });
        void this.rerender(false);
        break;
      case "toggleOrientation":
        this.session.apply({ type: "toggleOrientation", nodeId: message.nodeId });
        void this.rerender(false);
        break;
      case "saveLayout":
        void this.saveLayout();
        break;
      case "saveView":
        void this.saveView();
        break;
      case "loadView":
        this.session.apply({ type: "loadView", viewName: message.viewName });
        void this.rerender(true);
        break;
      case "selectElement":
        // Selection is presentational; no session state to update.
        break;
      case "focusEntity":
        this.session.apply({
          type: "focusEntity",
          nodeId: message.nodeId,
          hopCount: message.hopCount,
        });
        void this.rerender(true);
        break;
      case "clearFocus":
        this.session.apply({ type: "clearFocus" });
        void this.rerender(true);
        break;
      case "showNeighbors":
        this.session.apply({ type: "showNeighbors", nodeId: message.nodeId });
        void this.rerender(false);
        break;
      case "addGhostToView":
        void this.addGhostToView(message.nodeId);
        break;
      case "clearGhosts":
        this.session.apply({ type: "clearGhosts" });
        void this.rerender(false);
        break;
    }
  }

  /**
   * Watch the backing .orm.yaml document and auto-refresh on change. The
   * session prunes stale filter ids and expands an active view to touch
   * the new model.
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
    this.session.setModel(newModel);
    void this.rerender(false);
  }

  /** Run the session layout and push the presentation to the webview. */
  private async rerender(resetView: boolean): Promise<void> {
    if (this.disposed) return;
    const version = ++this.renderVersion;
    try {
      const presentation = await this.session.present();
      // Skip if a newer render was started while we were awaiting.
      if (version !== this.renderVersion) return;
      this.lastPresentation = presentation;
      this.postGraph(resetView);
    } catch (err) {
      if (version === this.renderVersion) {
        console.error("Diagram rerender failed:", err);
      }
    }
  }

  /** Post the last computed presentation to the webview. */
  private postGraph(resetView: boolean): void {
    if (this.disposed || !this.webviewReady || !this.lastPresentation) return;
    const presentation = this.lastPresentation;
    void this.panel.webview.postMessage({
      type: "setGraph",
      graph: presentation.graph,
      ghostNodeIds: presentation.ghostNodeIds,
      meta: this.buildMeta(presentation),
      resetView,
    });
  }

  private buildMeta(presentation: DiagramPresentation): DiagramMeta {
    const baseName = this.filePath ? path.basename(this.filePath) : "model.orm.yaml";
    return {
      fileName: baseName,
      modelName: presentation.modelName,
      hasUnsavedChanges: presentation.hasUnsavedLayout,
      focus: presentation.focus,
      view: presentation.view,
      availableViews: presentation.availableViews,
    };
  }

  /**
   * Save the current diagram layout back to the .orm.yaml `diagrams`
   * section. The session assembles the layout; the panel does the file I/O.
   */
  private async saveLayout(): Promise<void> {
    if (!this.filePath) return;
    const layoutName = this.session.viewName ?? "Default";
    const layout = this.session.buildLayout(layoutName);
    try {
      const freshModel = saveSerializer.deserialize(fs.readFileSync(this.filePath, "utf-8"));
      const existing = freshModel.getDiagramLayout(layoutName);
      if (existing) {
        freshModel.updateDiagramLayout({ ...layout, elements: existing.elements });
      } else {
        freshModel.addDiagramLayout(layout);
      }
      fs.writeFileSync(this.filePath, saveSerializer.serialize(freshModel), "utf-8");
      this.session.markSaved();
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
    if (!this.filePath) return;
    const focus = this.lastPresentation?.focus ?? null;
    const defaultName = focus ? `${focus.entityName} (${focus.hopCount}-hop)` : "New View";

    const name = await vscode.window.showInputBox({
      prompt: "Name for this diagram view",
      value: defaultName,
    });
    if (!name) return;

    const layout = this.session.buildViewLayout(name);
    try {
      const freshModel = saveSerializer.deserialize(fs.readFileSync(this.filePath, "utf-8"));
      if (freshModel.getDiagramLayout(name)) {
        freshModel.updateDiagramLayout(layout);
      } else {
        freshModel.addDiagramLayout(layout);
      }
      fs.writeFileSync(this.filePath, saveSerializer.serialize(freshModel), "utf-8");
      this.session.markSaved(name);
      this.postGraph(false);
      vscode.window.showInformationMessage(`View "${name}" saved.`);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to save view: ${(err as Error).message}`);
    }
  }

  /**
   * Move a ghost entity into the active view permanently and persist. The
   * session promotes the ghost and returns its name; the panel appends it
   * to the saved view's element list.
   */
  private async addGhostToView(entityId: string): Promise<void> {
    if (!this.filePath) return;
    const name = this.session.addGhostToView(entityId);
    const viewName = this.session.viewName;
    if (!name || !viewName) return;

    try {
      const freshModel = saveSerializer.deserialize(fs.readFileSync(this.filePath, "utf-8"));
      const layout = freshModel.getDiagramLayout(viewName);
      if (layout) {
        const elements = layout.elements ? [...layout.elements] : [];
        if (!elements.includes(name)) elements.push(name);
        freshModel.updateDiagramLayout({ ...layout, elements });
        fs.writeFileSync(this.filePath, saveSerializer.serialize(freshModel), "utf-8");
      }
    } catch {
      // Non-critical: the view still works in memory.
    }

    vscode.window.showInformationMessage(`Added "${name}" to "${viewName}".`);
    void this.rerender(false);
  }

  private setTitle(fileName: string): void {
    if (this.disposed) return;
    const baseName = path.basename(fileName, ".orm.yaml");
    this.panel.title = `Diagram: ${baseName}`;
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
