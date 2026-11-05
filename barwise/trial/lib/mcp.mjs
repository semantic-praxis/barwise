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
  // Parity compares whole answers, and a customer's DDL (40-50 KB) and
  // verbalization (about 10 KB) pass the server's 8 KB inline limit, so a
  // default server spills every one and parity compares nothing. The limit
  // is lifted for the lane; a spill that still happens is a step the lane
  // could not answer (steps.mjs, MCP_SPILL_NOTICE).
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP_BUNDLE],
    env: { ...process.env, BARWISE_MCP_INLINE_LIMIT: "100000000" },
  });
  await client.connect(transport);
  try {
    return await fn({
      call: async (name, args) => {
        const started = Date.now();
        const res = await client.callTool({ name, arguments: args });
        const blocks = (res?.content ?? []).filter((c) => c.type === "text").map((c) => c.text);
        return {
          text: blocks.join("\n"),
          blocks,
          isError: !!res.isError,
          ms: Date.now() - started,
        };
      },
      listTools: async () => (await client.listTools()).tools.map((t) => t.name),
    });
  } finally {
    await client.close().catch(() => {});
  }
}
