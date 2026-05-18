/**
 * orm-model://{path} resource template: returns a deserialized model as JSON.
 */

import { OrmYamlSerializer } from "@barwise/core";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFileSync } from "node:fs";

const serializer = new OrmYamlSerializer();

export function registerOrmModelResource(server: McpServer): void {
  server.registerResource(
    "orm-model",
    new ResourceTemplate("orm-model://{+path}", { list: undefined }),
    {
      title: "ORM Model",
      description: "Returns the deserialized ORM model from a .orm.yaml file as JSON. "
        + "Note: this returns the ENTIRE model and is unbounded -- a large model "
        + "can consume a lot of context. For specific questions prefer the "
        + "query_model tool, and for an overview prefer describe_domain; read this "
        + "resource only when you genuinely need the full raw model.",
      mimeType: "application/json",
    },
    async (uri, variables) => {
      const path = variables.path;
      const filePath = typeof path === "string" ? path : String(path);
      const yaml = readFileSync(filePath, "utf-8");
      const model = serializer.deserialize(yaml);

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(model, null, 2),
          },
        ],
      };
    },
  );
}
