/**
 * A stdio MCP client over the built server bundle, for the parity
 * sprint: the same input through the MCP tool and the CLI command must
 * yield the same finding. Same SDK client test-plan/mcp-checks.mjs uses.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCP_BUNDLE } from "./paths.mjs";

export async function withMcp(fn) {
  const client = new Client({ name: "barwise-trial", version: "1.0.0" }, { capabilities: {} });
  const transport = new StdioClientTransport({ command: process.execPath, args: [MCP_BUNDLE] });
  await client.connect(transport);
  try {
    return await fn({
      call: async (name, args) => {
        const started = Date.now();
        const res = await client.callTool({ name, arguments: args });
        const text = (res?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join(
          "\n",
        );
        return { text, isError: !!res.isError, ms: Date.now() - started };
      },
      listTools: async () => (await client.listTools()).tools.map((t) => t.name),
    });
  } finally {
    await client.close().catch(() => {});
  }
}
