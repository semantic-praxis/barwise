/**
 * Resource registration barrel. Registers all MCP resources on the server.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerOrmModelResource } from "./ormModel.js";
import { registerOrmSchemaResource } from "./ormSchema.js";
import { registerReasoningTrailResource } from "./reasoningTrail.js";

export function registerResources(server: McpServer): void {
  registerOrmSchemaResource(server);
  registerOrmModelResource(server);
  registerReasoningTrailResource(server);
}
