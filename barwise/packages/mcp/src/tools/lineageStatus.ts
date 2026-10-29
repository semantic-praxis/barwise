/**
 * lineage_status tool: check staleness of exported artifacts.
 */

import { checkStaleness, exportModels } from "@barwise/core/lineage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { basename, dirname, resolve } from "node:path";
import { readManifest } from "../workspace/lineageIo.js";
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
  // for. When they name more than one, comparing this model's hash with
  // another model's exports would report on artifacts it never made.
  if (!path && manifest) {
    const models = exportModels(manifest);
    if (models.length > 1) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(
            {
              error: `The lineage manifest in ${dir} holds the exports of ${models.length} `
                + `models (${models.join(", ")}). Pass the model as a file path so its own `
                + "exports are read.",
            },
            null,
            2,
          ),
        }],
      };
    }
  }

  const report = checkStaleness(manifest, model, path ? basename(resolve(path)) : undefined);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
  };
}
