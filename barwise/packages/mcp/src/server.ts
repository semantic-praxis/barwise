/**
 * MCP server definition. Creates and configures the McpServer with
 * all tools, resources, and prompts.
 *
 * Also re-exports execute functions from individual tools so that
 * consumers (e.g. the VS Code extension) can call them directly
 * without going through MCP transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/index.js";
import { registerTools } from "./tools/index.js";

export function createServer(): McpServer {
  const server = new McpServer({
    name: "barwise",
    version: "0.2.1",
  });

  registerTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

// Re-export execute functions for direct invocation (no MCP transport).
export { resolveSource } from "./helpers/resolve.js";
export { executeDescribeDomain } from "./tools/describeDomain.js";
export { executeDiagram } from "./tools/diagram.js";
export { executeDiff } from "./tools/diff.js";
export { executeExportModel } from "./tools/exportModel.js";
export { executeImpactAnalysis } from "./tools/impactAnalysis.js";
export { executeImport } from "./tools/import.js";
export { executeImportModel } from "./tools/importModel.js";
export { executeLineageStatus } from "./tools/lineageStatus.js";
export { executeMerge } from "./tools/merge.js";
export { executeQueryModel } from "./tools/queryModel.js";
export { executeReview } from "./tools/review.js";
export { executeSchema } from "./tools/schema.js";
export { executeValidate } from "./tools/validate.js";
export { executeVerbalize } from "./tools/verbalize.js";
