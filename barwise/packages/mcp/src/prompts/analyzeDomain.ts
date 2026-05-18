/**
 * analyze-domain prompt: guides AI through domain analysis and model extraction.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { CONTEXT_HYGIENE_GUIDANCE, MODELING_WORKFLOW_GUIDANCE } from "./guidance/guidance.js";

export function registerAnalyzeDomainPrompt(server: McpServer): void {
  server.registerPrompt(
    "analyze-domain",
    {
      title: "Analyze Business Domain",
      description: "Analyze a business domain transcript and extract a formal ORM 2 model. "
        + "Guides the AI through entity identification, fact type discovery, and "
        + "constraint analysis.",
      argsSchema: {
        transcript: z
          .string()
          .describe("The business domain transcript to analyze"),
      },
    },
    ({ transcript }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: `${MODELING_WORKFLOW_GUIDANCE}\n\n${CONTEXT_HYGIENE_GUIDANCE}\n\n`
              + "Analyze the following business domain transcript: identify "
              + "entity types, value types, fact types, and constraints, then "
              + "use the import_transcript tool to extract a formal ORM "
              + "model.\n\n"
              + `Transcript:\n${transcript}`,
          },
        },
      ],
    }),
  );
}
