/**
 * generate_schema tool: generates relational schema (DDL or JSON) from a model.
 */

import { RelationalMapper } from "@barwise/core/mapping";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSource, type SourceInput } from "../workspace/resolve.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";
import { executeExportModel } from "./exportModel.js";

export function registerSchemaTool(server: McpServer): void {
  server.registerTool(
    "generate_schema",
    {
      title: "Generate Relational Schema",
      description:
        "DEPRECATED: Use export_model with format='ddl' instead. This tool will be removed in a future version. "
        + "Generate a relational schema (DDL or JSON) from an ORM 2 model. "
        + "Maps object types and fact types to tables, columns, and keys.",
      inputSchema: {
        source: sourceInputSchema("File path to .orm.yaml or inline YAML content"),
        format: z
          .enum(["ddl", "json"])
          .default("ddl")
          .describe("Output format: DDL SQL or JSON mapping"),
      },
    },
    async ({ source, format }) => {
      return executeSchema(source, format);
    },
  );
}

export function executeSchema(
  source: SourceInput,
  format: "ddl" | "json" = "ddl",
): { content: Array<{ type: "text"; text: string; }>; } {
  if (format === "json") {
    const schema = new RelationalMapper().map(resolveSource(source));
    return {
      content: [
        { type: "text" as const, text: JSON.stringify(schema, null, 2) },
      ],
    };
  }

  // What export_model returns for DDL, by calling it: one DDL text per
  // model, bounded the same way, with the report block when the format
  // could not express a constraint (schema-ddl-routing.spec.md).
  return executeExportModel(source, "ddl", { annotate: false, includeExamples: false });
}
