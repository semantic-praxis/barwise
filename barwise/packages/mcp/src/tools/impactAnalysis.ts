/**
 * impact_analysis tool: analyze impact of changing a model element.
 */

import { analyzeImpact } from "@barwise/core/lineage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { readManifest } from "../workspace/lineageIo.js";
import { type SourceInput, sourcePath } from "../workspace/resolve.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";

export function registerImpactAnalysisTool(server: McpServer): void {
  server.registerTool(
    "impact_analysis",
    {
      title: "Analyze Impact",
      description: "Analyze the impact of changing a model element. "
        + "Given an element ID, returns which exported artifacts depend on that element.",
      inputSchema: {
        source: sourceInputSchema(
          "File path to .orm.yaml (needed to find project directory)",
        ),
        elementId: z
          .string()
          .describe("ID of the model element to analyze (entity, fact type, constraint, etc.)"),
      },
    },
    async ({ source, elementId }) => {
      return executeImpactAnalysis(source, elementId);
    },
  );
}

export function executeImpactAnalysis(
  source: SourceInput,
  elementId: string,
): { content: Array<{ type: "text"; text: string; }>; } {
  // Locate the manifest next to the model file when the source has a path;
  // otherwise fall back to the current working directory.
  const path = sourcePath(source);
  const dir = path ? dirname(resolve(path)) : process.cwd();

  const report = analyzeImpact(readManifest(dir), elementId);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
  };
}
