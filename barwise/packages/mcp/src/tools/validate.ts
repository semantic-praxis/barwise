/**
 * validate_model tool: validates an ORM model and returns diagnostics.
 */

import { type Diagnostic, type OrmModel, ValidationEngine } from "@barwise/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveModels, type SourceInput } from "../helpers/resolve.js";
import { sourceInputSchema } from "../helpers/sourceSchema.js";

export function registerValidateTool(server: McpServer): void {
  server.registerTool(
    "validate_model",
    {
      title: "Validate ORM Model",
      description: "Validate an ORM 2 model from a YAML string or file path. "
        + "Returns structured diagnostics (errors and warnings). Given a "
        + ".orm-project.yaml manifest, validates every domain (or one chosen "
        + "with `domain`).",
      inputSchema: {
        source: sourceInputSchema(
          "File path to .orm.yaml, .orm-project.yaml, or inline YAML content",
        ),
        domain: z
          .string()
          .optional()
          .describe("For a project source, validate only this one domain context"),
      },
    },
    async ({ source, domain }) => {
      return executeValidate(source, domain);
    },
  );
}

export function executeValidate(
  source: SourceInput,
  domain?: string,
): { content: Array<{ type: "text"; text: string; }>; } {
  const { resolved, problems } = resolveModels(source, domain);

  const blocks = resolved.map(({ context, model }) => {
    const result = validateOne(model);
    return context ? { domain: context, ...result } : result;
  });

  // Preserve the single-model output byte-for-byte: a plain model resolves
  // to one unlabelled block with no project warnings.
  const payload = blocks.length === 1
    ? blocks[0]
    : { domains: blocks, valid: blocks.every((b) => b.valid) };

  const body = problems.length > 0 ? { ...payload, warnings: problems } : payload;

  return {
    content: [{ type: "text" as const, text: JSON.stringify(body, null, 2) }],
  };
}

function validateOne(model: OrmModel): {
  valid: boolean;
  errorCount: number;
  warningCount: number;
  errors: ReturnType<typeof formatDiagnostic>[];
  warnings: ReturnType<typeof formatDiagnostic>[];
} {
  const engine = new ValidationEngine();
  const diagnostics = engine.validate(model);

  const errors = diagnostics.filter((d: Diagnostic) => d.severity === "error");
  const warnings = diagnostics.filter((d: Diagnostic) => d.severity === "warning");

  return {
    valid: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    errors: errors.map(formatDiagnostic),
    warnings: warnings.map(formatDiagnostic),
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
