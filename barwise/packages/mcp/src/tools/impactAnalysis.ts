/**
 * impact_analysis tool: analyze impact of changing a model element.
 */

import { analyzeImpact } from "@barwise/core/lineage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { readManifest } from "../helpers/lineageIo.js";

export function registerImpactAnalysisTool(server: McpServer): void {
  server.registerTool(
    "impact_analysis",
    {
      title: "Analyze Impact",
      description: "Analyze the impact of changing a model element. "
        + "Given an element ID, returns which exported artifacts depend on that element.",
      inputSchema: {
        source: z
          .string()
          .describe("File path to .orm.yaml (needed to find project directory)"),
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
  source: string,
  elementId: string,
): { content: Array<{ type: "text"; text: string; }>; } {
  // Determine the directory for manifest lookup
  // If source looks like a file path, use its directory
  // Otherwise use current working directory
  let dir: string;
  if (!source.includes("\n") && (source.endsWith(".yaml") || source.endsWith(".yml"))) {
    dir = dirname(resolve(source));
  } else {
    dir = process.cwd();
  }

  const report = analyzeImpact(readManifest(dir), elementId);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
  };
}
