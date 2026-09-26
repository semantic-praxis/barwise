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

  it("answers the handshake and lists every registered tool", async () => {
    // The complete list, not a sample: with four names sampled, the
    // whole suite stayed green while `review_model` and `merge_models`
    // were unregistered (the 2026-08-25 assertion audit ran exactly
    // that mutation). Per-tool tests call executeX directly, so this
    // is the only test that fails when a registration is dropped --
    // it is the executable form of the capability matrix's MCP column.
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "analyze_repository",
      "describe_domain",
      "diff_models",
      "export_model",
      "generate_diagram",
      "generate_schema",
      "gym_check",
      "gym_list",
      "impact_analysis",
      "import_model",
      "import_transcript",
      "lineage_status",
      "merge_models",
      "query_model",
      "review_model",
      "validate_model",
      "verbalize_model",
    ]);
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

  it("mints UUIDv7 ids, so the entry point installed the generator", async () => {
    // The generator is tested in core with a fake clock; this is the
    // wiring core cannot see. Without the install line in src/index.ts
    // the import still succeeds, with v4 ids
    // (docs/specs/uuid7-generator-factory.spec.md).
    const result = await client.callTool({
      name: "import_model",
      arguments: {
        source: "CREATE TABLE customers (customer_id INTEGER PRIMARY KEY, name TEXT);",
        format: "ddl",
      },
    });
    const text = (result.content as Array<{ type: string; text: string; }>)[0]!.text;
    const ids = [...text.matchAll(/^\s*(?:- )?id: (\S+)$/gm)].map((m) => m[1]!);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    }
  });

  it("lists resources", async () => {
    const { resources } = await client.listResources();
    expect(resources.length).toBeGreaterThan(0);
  });
});
