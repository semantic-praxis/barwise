/**
 * lineage_status tool: check staleness of exported artifacts.
 */

import { checkStaleness, exportModels } from "@barwise/core/lineage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { modelFileName, modelsBeside, readManifest } from "../workspace/lineageIo.js";
import { resolveSource, type SourceInput, sourcePath } from "../workspace/resolve.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";

export function registerLineageStatusTool(server: McpServer): void {
  server.registerTool(
    "lineage_status",
    {
      title: "Check Lineage Status",
      description:
        "Check staleness of exported artifacts by comparing current model against lineage manifest. "
        + "Returns which artifacts are stale (out of date) vs fresh (up to date).",
      inputSchema: {
        source: sourceInputSchema(
          "File path to .orm.yaml (needed to find project directory and model)",
        ),
      },
    },
    async ({ source }) => {
      return executeLineageStatus(source);
    },
  );
}

export function executeLineageStatus(
  source: SourceInput,
): { content: Array<{ type: "text"; text: string; }>; } {
  const model = resolveSource(source);

  // Locate the manifest next to the model file when the source has a path;
  // otherwise fall back to the current working directory.
  const path = sourcePath(source);
  const dir = path ? dirname(resolve(path)) : process.cwd();

  const manifest = readManifest(dir);

  // Inline YAML names no file, so there is no model to read the exports
  // for. When they name more than one, or one beside exports that name
  // none (another domain's, perhaps, from before exports named a model),
  // comparing this model's hash with them would report on artifacts it
  // never made. A manifest whose exports all name none is read as before.
  if (!path && manifest) {
    const models = exportModels(manifest);
    const mixed = models.length === 1 && manifest.exports.some((e) => e.sourceModel === undefined);
    if (models.length > 1 || mixed) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            {
              error: `The lineage manifest in ${dir} holds the exports of ${models.join(", ")}`
                + `${mixed ? " and exports naming no model" : ""}. `
                + "Pass the model as a file path so its own exports are read.",
            },
            null,
            2,
          ),
        }],
      };
    }
  }

  const report = checkStaleness(
    manifest,
    model,
    path ? { sourceModel: modelFileName(path), modelsBeside: modelsBeside(dir) } : undefined,
  );

  return {
    content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
  };
}
