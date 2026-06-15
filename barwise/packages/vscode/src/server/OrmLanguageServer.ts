import { TextDocument } from "vscode-languageserver-textdocument";
import {
  type CompletionItem,
  createConnection,
  type Hover,
  type InitializeParams,
  type InitializeResult,
  ProposedFeatures,
  type TextDocumentPositionParams,
  TextDocuments,
  TextDocumentSyncKind,
} from "vscode-languageserver/node.js";
import { CompletionProvider } from "./CompletionProvider.js";
import { DiagnosticsProvider } from "./DiagnosticsProvider.js";
import { HoverProvider } from "./HoverProvider.js";

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

let diagnosticsProvider: DiagnosticsProvider;
let completionProvider: CompletionProvider;
let hoverProvider: HoverProvider;

connection.onInitialize((params: InitializeParams): InitializeResult => {
  const initOptions = (params.initializationOptions ?? {}) as {
    showCounterexamplesOnHover?: boolean;
  };
  diagnosticsProvider = new DiagnosticsProvider(connection);
  completionProvider = new CompletionProvider();
  hoverProvider = new HoverProvider(
    initOptions.showCounterexamplesOnHover ?? false,
  );

  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Full,
      completionProvider: {
        resolveProvider: false,
        triggerCharacters: ['"', ":", " "],
      },
      hoverProvider: true,
    },
  };
});

// Validate on open and change.
documents.onDidChangeContent((change) => {
  if (isOrmYaml(change.document.uri)) {
    diagnosticsProvider.validate(change.document);
  }
});

documents.onDidOpen((event) => {
  if (isOrmYaml(event.document.uri)) {
    diagnosticsProvider.validate(event.document);
  }
});

// Completion.
connection.onCompletion(
  (params: TextDocumentPositionParams): CompletionItem[] => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || !isOrmYaml(doc.uri)) return [];
    return completionProvider.provideCompletions(doc, params.position);
  },
);

// Hover.
connection.onHover(
  (params: TextDocumentPositionParams): Hover | null => {
    const doc = documents.get(params.textDocument.uri);
    if (!doc || !isOrmYaml(doc.uri)) return null;
    return hoverProvider.provideHover(doc, params.position);
  },
);

function isOrmYaml(uri: string): boolean {
  return uri.endsWith(".orm.yaml");
}

documents.listen(connection);
connection.listen();
