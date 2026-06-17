/**
 * validate_model tool: validates an ORM model and returns diagnostics.
 */

import { type Diagnostic, ValidationEngine } from "@barwise/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSource } from "../helpers/resolve.js";

export function registerValidateTool(server: McpServer): void {
  server.registerTool(
    "validate_model",
    {
      title: "Validate ORM Model",
      description: "Validate an ORM 2 model from a YAML string or file path. "
        + "Returns structured diagnostics (errors and warnings).",
      inputSchema: {
        source: z
          .string()
          .describe("File path to .orm.yaml or inline YAML content"),
      },
    },
    async ({ source }) => {
      return executeValidate(source);
    },
  );
}

export function executeValidate(
  source: string,
): { content: Array<{ type: "text"; text: string; }>; } {
  const model = resolveSource(source);

  const engine = new ValidationEngine();
  const diagnostics = engine.validate(model);

  const errors = diagnostics.filter(
    (d: Diagnostic) => d.severity === "error",
  );
  const warnings = diagnostics.filter(
    (d: Diagnostic) => d.severity === "warning",
  );

  const result = {
    valid: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: errors.map(formatDiagnostic),
    warnings: warnings.map(formatDiagnostic),
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

function formatDiagnostic(d: Diagnostic): {
  severity: string;
  ruleId: string;
  message: string;
} {
  return {
    severity: d.severity,
    ruleId: d.ruleId,
    message: d.message,
  };
}
