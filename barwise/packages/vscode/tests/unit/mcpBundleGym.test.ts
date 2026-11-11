/**
 * The MCP server bundled into the extension runs the gym tools
 * (barwise-fbi).
 *
 * dist/mcp/index.js is a CJS esbuild bundle, where import.meta.url is
 * empty; learn resolved its catalog from it, so gym_list returned a Node
 * path error from the server shipped in barwise-vscode-2.0.0.vsix while
 * every source-level suite was green. This spawns that file -- `build`
 * writes it, and turbo builds before tests -- and talks to it over stdio.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const server = resolve(dirname(fileURLToPath(import.meta.url)), "../../dist/mcp/index.js");

let client: Client;

describe("VS Code-embedded MCP server: gym tools", () => {
  beforeAll(async () => {
    expect(existsSync(server), `built server missing: ${server} (run npm run build)`).toBe(true);
    client = new Client({ name: "gym-bundle", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [server] }));
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("gym_list lists the packaged exercises", async () => {
    const r = await client.callTool({ name: "gym_list", arguments: {} });
    const text = (r.content as { type: string; text: string; }[])[0]?.text ?? JSON.stringify(r);
    expect(r.isError, text).toBeFalsy();
    expect(JSON.parse(text).map((e: { id: string; }) => e.id)).toContain("customer-order");
  });
});
