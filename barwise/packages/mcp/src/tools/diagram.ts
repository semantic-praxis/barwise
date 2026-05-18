/**
 * generate_diagram tool: generates an SVG diagram from a model.
 */

import { generateDiagram } from "@barwise/diagram";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSource } from "../helpers/resolve.js";
import { boundedTextResult } from "../helpers/response.js";

export function registerDiagramTool(server: McpServer): void {
  server.registerTool(
    "generate_diagram",
    {
      title: "Generate ORM Diagram",
      description:
        "DEPRECATED: Use export_model with format='svg' instead. This tool will be removed in a future version. "
        + "Generate an SVG diagram from an ORM 2 model. "
        + "Large diagrams are written to a file and the tool returns the file path; "
        + "do not expect raw SVG markup to be returned inline.",
      inputSchema: {
        source: z
          .string()
          .describe("File path to .orm.yaml or inline YAML content"),
      },
    },
    async ({ source }) => {
      return executeDiagram(source);
    },
  );
}

export async function executeDiagram(
  source: string,
): Promise<{ content: Array<{ type: "text"; text: string; }>; }> {
  const model = resolveSource(source);
  const result = await generateDiagram(model);

  return boundedTextResult(result.svg, {
    kind: "diagram",
    source,
    extension: "svg",
  });
}
