/**
 * diff_models tool: computes the diff between two ORM models.
 */

import { diffModels } from "@barwise/core/diff";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSource } from "../helpers/resolve.js";

export function registerDiffTool(server: McpServer): void {
  server.registerTool(
    "diff_models",
    {
      title: "Diff ORM Models",
      description: "Compare two ORM 2 models and return the structural deltas. "
        + "Shows added, removed, and modified elements with breaking-level indicators.",
      inputSchema: {
        base: z
          .string()
          .describe("File path or inline YAML for the base model"),
        incoming: z
          .string()
          .describe("File path or inline YAML for the incoming model"),
      },
    },
    async ({ base, incoming }) => {
      return executeDiff(base, incoming);
    },
  );
}

export function executeDiff(
  base: string,
  incoming: string,
): { content: Array<{ type: "text"; text: string; }>; } {
  const baseModel = resolveSource(base);
  const incomingModel = resolveSource(incoming);
  const diff = diffModels(baseModel, incomingModel);

  const result = {
    hasChanges: diff.hasChanges,
    deltas: diff.deltas
      .filter((d) => d.kind !== "unchanged")
      .map((d) => ({
        kind: d.kind,
        elementType: d.elementType,
        name: d.elementType === "definition" ? d.term : d.name,
        breakingLevel: d.breakingLevel,
        changeDescriptions: d.changeDescriptions,
      })),
    synonymCandidates: diff.synonymCandidates,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}
