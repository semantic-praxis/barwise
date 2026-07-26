/**
 * Stdio spawn smoke test (the carried-forward T2 gap): every other MCP
 * test calls handler functions directly, so nothing verified that the
 * built server actually starts as a child process and answers over the
 * real stdio transport. This spawns `dist/index.js` (turbo builds
 * before tests) with the official SDK client, performs the handshake,
 * and asserts the tool/resource surface is registered.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ENTRY = resolve(__dirname, "../dist/index.js");

describe("MCP server stdio spawn", () => {
  let client: Client;

  beforeAll(async () => {
    expect(existsSync(SERVER_ENTRY), `built entry missing: ${SERVER_ENTRY}`).toBe(true);
    client = new Client({ name: "spawn-smoke", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY] }),
    );
  }, 30_000);

  afterAll(async () => {
    await client?.close();
  });

  it("answers the handshake and lists the registered tools", async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toContain("validate_model");
    expect(names).toContain("verbalize_model");
    expect(names).toContain("gym_check");
    expect(names).toContain("analyze_repository");
  });

  it("executes a tool end-to-end over the transport", async () => {
    const inline = [
      'orm_version: "1.0"',
      "model:",
      "  name: Smoke",
      "  object_types:",
      "    - id: ot-a",
      "      name: A",
      "      kind: entity",
      "      reference_mode: a_id",
    ].join("\n");
    const result = await client.callTool({
      name: "validate_model",
      arguments: { source: inline },
    });
    const text = (result.content as Array<{ type: string; text: string; }>)[0]!.text;
    expect(JSON.parse(text)).toMatchObject({ valid: true });
  });

  it("lists resources", async () => {
    const { resources } = await client.listResources();
    expect(resources.length).toBeGreaterThan(0);
  });
});
