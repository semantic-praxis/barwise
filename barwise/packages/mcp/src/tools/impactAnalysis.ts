/**
 * impact_analysis tool: analyze impact of changing a model element.
 */

import type { OrmModel } from "@barwise/core";
import { analyzeImpact } from "@barwise/core/lineage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { modelLocation, modelsBeside, readManifest } from "../workspace/lineageIo.js";
import { resolveSource, type SourceInput, sourcePath } from "../workspace/resolve.js";
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
  const location = path ? modelLocation(path) : undefined;
  const dir = location?.dir ?? process.cwd();

  // With a path, only that model's exports are read. Without one there is
  // no model to read for, so every export holding the id is, and the
  // report names each export's model (iri-identity 6a).
  // The model, when it loads, so an id a 3.x file states finds the exports
  // that recorded its 4.0 id (barwise-wcg.v5k). Only with a path: inline,
  // every model's exports are read, and one model's ids say nothing of
  // another's.
  const manifest = readManifest(dir);
  let model: OrmModel | undefined;
  // Set when a path's model did not load: a 3.x id is then not read, which
  // changes the answer, so the caller is told. Inline has no model by design.
  let modelDidNotLoad = false;
  if (location && manifest) {
    try {
      model = resolveSource(source);
    } catch {
      modelDidNotLoad = true;
    }
  }
  const report = analyzeImpact(
    manifest,
    elementId,
    location ? { sourceModel: location.sourceModel, modelsBeside: modelsBeside(dir) } : undefined,
    model,
  );

  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify(
        modelDidNotLoad ? { ...report, modelDidNotLoad: true } : report,
        null,
        2,
      ),
    }],
  };
}
