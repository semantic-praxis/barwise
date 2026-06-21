/**
 * lineage_status tool: check staleness of exported artifacts.
 */

import { checkStaleness } from "@barwise/core/lineage";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { readManifest } from "../helpers/lineageIo.js";
import { resolveSource, type SourceInput, sourcePath } from "../helpers/resolve.js";
import { sourceInputSchema } from "../helpers/sourceSchema.js";

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

  const report = checkStaleness(readManifest(dir), model);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
  };
}
