import { OrmYamlSerializer } from "@barwise/core";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from "vscode-languageclient/node.js";
import { registerChatParticipant } from "../chat/ChatParticipant.js";
import { ExportCommand } from "../commands/ExportCommand.js";
import { ImportCommand } from "../commands/ImportCommand.js";
import { NewProjectCommand } from "../commands/NewProjectCommand.js";
import { ShowDiagramCommand } from "../commands/ShowDiagramCommand.js";
import { ValidateModelCommand } from "../commands/ValidateModelCommand.js";
import { VerbalizeCommand } from "../commands/VerbalizeCommand.js";
import { DiagramPanel } from "../diagram/DiagramPanel.js";
import { registerMcpServerProvider } from "../mcp/McpServerProvider.js";
import { registerLanguageModelTools } from "../mcp/ToolRegistration.js";
import { ModelTreeProvider } from "../sidebar/ModelTreeProvider.js";

let client: LanguageClient;

export function activate(context: vscode.ExtensionContext): void {
  // Start language server.
  const serverModule = context.asAbsolutePath(
    path.join("dist", "server", "OrmLanguageServer.js"),
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ["--nolazy", "--inspect=6009"] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", pattern: "**/*.orm.yaml" },
    ],
    initializationOptions: {
      showCounterexamplesOnHover: vscode.workspace
        .getConfiguration("barwise")
        .get<boolean>("showCounterexamplesOnHover", false),
    },
  };

  client = new LanguageClient(
    "barwiseOrmLanguageServer",
    "Barwise Language Server",
    serverOptions,
    clientOptions,
  );

  client.start();

  // Register commands.
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "barwise.newProject",
      () => new NewProjectCommand().execute(),
    ),
    vscode.commands.registerCommand(
      "barwise.validateModel",
      () => new ValidateModelCommand().execute(),
    ),
    vscode.commands.registerCommand(
      "barwise.verbalize",
      () => new VerbalizeCommand().execute(),
    ),
    vscode.commands.registerCommand(
      "barwise.showDiagram",
      () => new ShowDiagramCommand(context.extensionUri).execute(),
    ),
    vscode.commands.registerCommand(
      "barwise.import",
      () => new ImportCommand().execute(),
    ),
    vscode.commands.registerCommand(
      "barwise.export",
      () => new ExportCommand().execute(),
    ),
    vscode.commands.registerCommand(
      "barwise.highlightInDiagram",
      (first: unknown, second?: unknown) => {
        // Called two ways:
        // 1. Tree item click: (elementId: string, kind: string)
        // 2. Context menu: (ModelTreeItem: {id, kind, label, ...})
        let elementId: string | undefined;
        let kind: string | undefined;
        if (typeof first === "string") {
          elementId = first;
          kind = second as string;
        } else if (first && typeof first === "object") {
          const item = first as { id?: string; kind?: string; };
          elementId = item.id;
          kind = item.kind;
        }
        if (elementId && kind) {
          DiagramPanel.highlightElement(elementId, kind);
        }
      },
    ),
    vscode.commands.registerCommand(
      "barwise.loadView",
      (viewName: string) => {
        DiagramPanel.loadView(viewName);
      },
    ),
    vscode.commands.registerCommand(
      "barwise.addToView",
      async (first: unknown, _second?: unknown) => {
        // Resolve element name from click or context menu args.
        let elementName: string | undefined;
        if (typeof first === "string") {
          // From item.command args: (elementId, kind)
          // We need the name, not the ID. Look it up from the active editor model.
        } else if (first && typeof first === "object") {
          elementName = (first as { label?: string; }).label;
        }

        // Read model from active editor.
        const editor = vscode.window.activeTextEditor;
        const filePath = editor?.document.fileName;
        if (!filePath?.endsWith(".orm.yaml")) {
          vscode.window.showWarningMessage("Open an .orm.yaml file first.");
          return;
        }

        const serializer = new OrmYamlSerializer();
        let model;
        try {
          model = serializer.deserialize(fs.readFileSync(filePath, "utf-8"));
        } catch {
          vscode.window.showErrorMessage("Failed to parse model.");
          return;
        }

        // If we got an ID instead of a name, resolve it.
        if (!elementName && typeof first === "string") {
          const ot = model.getObjectType(first);
          elementName = ot?.name;
        }
        if (!elementName) return;

        // Get existing views that have element subsets.
        const views = model.diagramLayouts.filter(
          (dl) => dl.elements && dl.elements.length > 0,
        );

        if (views.length === 0) {
          vscode.window.showInformationMessage(
            "No saved views yet. Use the hop toolbar's Save View button to create one.",
          );
          return;
        }

        // Show QuickPick with view names.
        const picked = await vscode.window.showQuickPick(
          views.map((v) => ({
            label: v.name,
            description: `${v.elements!.length} elements`,
            detail: v.elements!.includes(elementName!)
              ? "(already included)"
              : undefined,
          })),
          { placeHolder: `Add "${elementName}" to which view?` },
        );
        if (!picked) return;

        // Add element to the view.
        const view = model.getDiagramLayout(picked.label);
        if (!view) return;

        const currentElements = view.elements ? [...view.elements] : [];
        if (currentElements.includes(elementName)) {
          vscode.window.showInformationMessage(
            `"${elementName}" is already in "${view.name}".`,
          );
          return;
        }
        currentElements.push(elementName);

        model.updateDiagramLayout({
          ...view,
          elements: currentElements,
        });

        const yaml = serializer.serialize(model);
        fs.writeFileSync(filePath, yaml, "utf-8");
        vscode.window.showInformationMessage(
          `Added "${elementName}" to "${view.name}".`,
        );
      },
    ),
    vscode.commands.registerCommand(
      "barwise.copyElementName",
      (item: unknown) => {
        // Context menu passes the ModelTreeItem data element.
        const name = (item as { label?: string; })?.label;
        if (name) {
          void vscode.env.clipboard.writeText(name);
          vscode.window.showInformationMessage(`Copied: ${name}`);
        }
      },
    ),
    vscode.commands.registerCommand(
      "barwise.createView",
      async () => {
        // Read model from active editor.
        const editor = vscode.window.activeTextEditor;
        const filePath = editor?.document.fileName;
        if (!filePath?.endsWith(".orm.yaml")) {
          vscode.window.showWarningMessage("Open an .orm.yaml file first.");
          return;
        }

        const serializer = new OrmYamlSerializer();
        let model;
        try {
          model = serializer.deserialize(fs.readFileSync(filePath, "utf-8"));
        } catch {
          vscode.window.showErrorMessage("Failed to parse model.");
          return;
        }

        // Prompt for view name.
        const name = await vscode.window.showInputBox({
          prompt: "Name for the new diagram view",
          placeHolder: "e.g., Core Entities",
        });
        if (!name) return;

        // Check for duplicate.
        if (model.getDiagramLayout(name)) {
          vscode.window.showWarningMessage(`View "${name}" already exists.`);
          return;
        }

        // Show multi-select picker for entity/value types.
        const items = model.objectTypes.map((ot) => ({
          label: ot.name,
          description: ot.kind,
          picked: false,
        }));

        const picked = await vscode.window.showQuickPick(items, {
          canPickMany: true,
          placeHolder: "Select entities to include in the view",
        });
        if (!picked || picked.length === 0) return;

        const elements = picked.map((p) => p.label);
        model.addDiagramLayout({ name, elements, positions: {}, orientations: {} });

        const yaml = serializer.serialize(model);
        fs.writeFileSync(filePath, yaml, "utf-8");
        vscode.window.showInformationMessage(
          `Created view "${name}" with ${elements.length} elements.`,
        );
      },
    ),
    registerMcpServerProvider(context),
  );

  // Register the sidebar model browser tree view.
  const modelTree = new ModelTreeProvider();
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("barwise.modelTree", modelTree),
  );

  // Refresh the tree when the active editor changes to an .orm.yaml file.
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      if (editor?.document.fileName.endsWith(".orm.yaml")) {
        modelTree.refresh(editor.document);
      }
    }),
  );

  // Refresh the tree when an .orm.yaml document is saved.
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (doc.fileName.endsWith(".orm.yaml")) {
        modelTree.refresh(doc);
      }
    }),
  );

  // Seed with the active editor if it's already an .orm.yaml file.
  if (vscode.window.activeTextEditor?.document.fileName.endsWith(".orm.yaml")) {
    modelTree.refresh(vscode.window.activeTextEditor.document);
  }

  // Register Language Model Tools (vscode.lm.registerTool) so that
  // Copilot Chat and other AI features can invoke barwise tools
  // directly in the extension host process (with Copilot access).
  registerLanguageModelTools(context);

  // Register the @barwise chat participant so users can invoke barwise
  // directly in Copilot Chat (e.g. "@barwise import this transcript").
  registerChatParticipant(context);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
