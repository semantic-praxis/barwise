/**
 * diff_models tool: computes the diff between two ORM models.
 */

import {
  deltaToJson,
  diffModels,
  ELEMENT_MATCHINGS,
  type ElementMatching,
} from "@barwise/core/diff";

/** The element kinds a declared rename names; the editor's schema is pinned to it. */
export const DIFF_RENAME_KINDS = ["objectType", "factType"] as const;

/** A rename the caller declares, as the tool's input takes it. */
export interface DiffRenameInput {
  readonly kind: (typeof DIFF_RENAME_KINDS)[number];
  readonly from: string;
  readonly to: string;
}
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSource, type SourceInput } from "../workspace/resolve.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";

export function registerDiffTool(server: McpServer): void {
  server.registerTool(
    "diff_models",
    {
      title: "Diff ORM Models",
      description: "Compare two ORM 2 models and return the structural deltas. "
        + "Shows added, removed, and modified elements with breaking-level indicators. "
        + "An object type or fact type renamed without keeping its id is recognized by "
        + "what it says and reported with pairedBy: 'recognized'; for one that was renamed "
        + "and changed at once, declare it in renames (pairedBy: 'declared').",
      inputSchema: {
        base: sourceInputSchema("File path or inline YAML for the base model"),
        incoming: sourceInputSchema("File path or inline YAML for the incoming model"),
        matching: z.enum(ELEMENT_MATCHINGS).optional().describe(
          "How elements pair. 'id-first' (default): a shared id is the same element, "
            + "so a rename that keeps the id is one change. 'content': ids say nothing; "
            + "use it for two models whose ids are unrelated but may coincide, such as "
            + "two independent extractions numbered from one counter.",
        ),
        renames: z.array(z.object({
          kind: z.enum(DIFF_RENAME_KINDS),
          from: z.string().min(1).describe("Its name in the base model"),
          to: z.string().min(1).describe("Its name in the incoming model"),
        })).optional().describe(
          "Renames to pair that the diff cannot recognize because the element also changed",
        ),
      },
    },
    async ({ base, incoming, matching, renames }) => {
      return executeDiff(base, incoming, matching, renames);
    },
  );
}

export function executeDiff(
  base: SourceInput,
  incoming: SourceInput,
  matching?: ElementMatching,
  renames: readonly DiffRenameInput[] = [],
): { content: Array<{ type: "text"; text: string; }>; } {
  const baseModel = resolveSource(base);
  const incomingModel = resolveSource(incoming);
  const diff = diffModels(baseModel, incomingModel, {
    matching,
    renames: renames.map((r) => ({ target: { kind: r.kind, name: r.from }, to: r.to })),
  });

  const result = {
    hasChanges: diff.hasChanges,
    deltas: diff.deltas
      .filter((d) => d.kind !== "unchanged")
      .map(deltaToJson),
    synonymCandidates: diff.synonymCandidates,
  };

  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}
