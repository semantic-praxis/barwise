/**
 * lineage_status tool: check staleness of exported artifacts.
 */

import { checkStaleness } from "@barwise/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { readManifest } from "../helpers/lineageIo.js";
import { resolveSource } from "../helpers/resolve.js";

export function registerLineageStatusTool(server: McpServer): void {
  server.registerTool(
    "lineage_status",
    {
      title: "Check Lineage Status",
      description:
        "Check staleness of exported artifacts by comparing current model against lineage manifest. "
        + "Returns which artifacts are stale (out of date) vs fresh (up to date).",
      inputSchema: {
        source: z
          .string()
          .describe(
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
  source: string,
): { content: Array<{ type: "text"; text: string; }>; } {
  const model = resolveSource(source);

  // Determine the directory for manifest lookup
  // If source looks like a file path, use its directory
  // Otherwise use current working directory
  let dir: string;
  if (!source.includes("\n") && (source.endsWith(".yaml") || source.endsWith(".yml"))) {
    dir = dirname(resolve(source));
  } else {
    dir = process.cwd();
  }

  const report = checkStaleness(readManifest(dir), model);

  return {
    content: [{ type: "text" as const, text: JSON.stringify(report, null, 2) }],
  };
}
