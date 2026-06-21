import {
  type Diagnostic as OrmDiagnostic,
  OrmYamlSerializer,
  ProjectSerializer,
  ValidationEngine,
} from "@barwise/core";
import type { TextDocument } from "vscode-languageserver-textdocument";
import type { Connection } from "vscode-languageserver/node.js";
import { Diagnostic, DiagnosticSeverity } from "vscode-languageserver/node.js";
import { YamlSourceMap } from "./YamlSourceMap.js";

const ZERO_RANGE = {
  start: { line: 0, character: 0 },
  end: { line: 0, character: 0 },
} as const;

/**
 * Provides diagnostics for .orm.yaml files by running the core
 * validation engine and mapping results to LSP diagnostics.
 *
 * Diagnostics are positioned at the YAML source location of the
 * affected model element using a source map built from the YAML AST.
 */
export class DiagnosticsProvider {
  private readonly connection: Connection;
  private readonly serializer = new OrmYamlSerializer();
  private readonly projectSerializer = new ProjectSerializer();
  private readonly validationEngine = new ValidationEngine();

  constructor(connection: Connection) {
    this.connection = connection;
  }

  /**
   * Parse the document, run validation, and send diagnostics.
   */
  validate(document: TextDocument): void {
    const diagnostics: Diagnostic[] = [];
    const text = document.getText();

    try {
      const sourceMap = new YamlSourceMap(text);
      const model = this.serializer.deserialize(text);
      const ormDiagnostics = this.validationEngine.validate(model);

      for (const d of ormDiagnostics) {
        const pos = sourceMap.getPosition(d.elementId);
        const range = pos
          ? {
            start: { line: pos.line, character: pos.character },
            end: { line: pos.line, character: pos.character },
          }
          : ZERO_RANGE;

        diagnostics.push({
          severity: mapSeverity(d.severity),
          range,
          message: d.message,
          source: `barwise (${d.ruleId})`,
        });
      }
    } catch (err) {
      // Deserialization error -- report as a parse error.
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: ZERO_RANGE,
        message: (err as Error).message,
        source: "barwise (parse)",
      });
    }

    this.connection.sendDiagnostics({
      uri: document.uri,
      diagnostics,
    });
  }

  /**
   * Validate a `.orm-project.yaml` manifest against the project schema and
   * send diagnostics. This checks the manifest's own structure (its domain
   * and mapping declarations) -- not the referenced domain models, which are
   * separate `.orm.yaml` documents validated in their own right. A malformed
   * manifest is reported as a single parse error at the top of the file.
   */
  validateProject(document: TextDocument): void {
    const diagnostics: Diagnostic[] = [];

    try {
      this.projectSerializer.deserialize(document.getText());
    } catch (err) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: ZERO_RANGE,
        message: (err as Error).message,
        source: "barwise (project)",
      });
    }

    this.connection.sendDiagnostics({
      uri: document.uri,
      diagnostics,
    });
  }
}

function mapSeverity(
  severity: OrmDiagnostic["severity"],
): DiagnosticSeverity {
  switch (severity) {
    case "error":
      return DiagnosticSeverity.Error;
    case "warning":
      return DiagnosticSeverity.Warning;
    case "info":
      return DiagnosticSeverity.Information;
    default:
      return DiagnosticSeverity.Information;
  }
}
