/**
 * generate_diagram tool: generates an SVG diagram from a model.
 */

import { collectAnnotationMap } from "@barwise/core/annotation";
import { generateDiagram } from "@barwise/diagram";
import { renderDiagramSvg } from "@barwise/diagram-ui/server";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { resolveSource, type SourceInput, sourcePath } from "../workspace/resolve.js";
import { boundedTextResult } from "../workspace/response.js";
import { sourceInputSchema } from "../workspace/sourceSchema.js";

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
        source: sourceInputSchema("File path to .orm.yaml or inline YAML content"),
        annotate: z
          .boolean()
          .optional()
          .describe(
            "When false, omit needs-attention markers (dashed borders + "
              + "TODO titles) derived from model annotations. Default true.",
          ),
      },
    },
    async ({ source, annotate }) => {
      return executeDiagram(source, annotate);
    },
  );
}

export async function executeDiagram(
  source: SourceInput,
  annotate = true,
): Promise<{ content: Array<{ type: "text"; text: string; }>; }> {
  const model = resolveSource(source);
  const result = await generateDiagram(
    model,
    annotate ? { annotations: collectAnnotationMap(model) } : undefined,
  );

  return boundedTextResult(renderDiagramSvg(result.layout), {
    kind: "diagram",
    source: sourcePath(source),
    extension: "svg",
  });
}
