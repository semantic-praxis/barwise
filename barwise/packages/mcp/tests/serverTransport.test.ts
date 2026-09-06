/**
 * End-to-end transport test: connects a real MCP Client to the server
 * built by createServer() over an in-memory transport (test-plan/
 * mcp-checks.mjs does the same thing over stdio against the built
 * bundle). Every other test in this package calls a tool's exported
 * executeX function directly, so nothing else runs the
 * server.registerTool/registerResource/registerPrompt callback that
 * destructures the MCP request and forwards it -- this is what
 * exercises that wrapper, and the zod input-schema validation in
 * front of it, for every registered capability.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "fixtures");
const simple = `${fixtures}/simple.orm.yaml`;
const simpleModified = `${fixtures}/simple-modified.orm.yaml`;
const gymReference = resolve(__dirname, "../../learn/exercises/customer-order.reference.orm.yaml");

describe("MCP server (in-memory transport)", () => {
  let client: Client;

  beforeAll(async () => {
    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "in-memory-test", version: "0.0.0" });
    await Promise.all([
      client.connect(clientTransport),
      server.connect(serverTransport),
    ]);
  });

  afterAll(async () => {
    await client.close();
  });

  it("validate_model", async () => {
    const r = await client.callTool({ name: "validate_model", arguments: { source: simple } });
    expect(r.isError).toBeFalsy();
  });

  it("verbalize_model", async () => {
    const r = await client.callTool({
      name: "verbalize_model",
      arguments: { source: simple, mode: "summary" },
    });
    expect(r.isError).toBeFalsy();
  });

  it("generate_schema", async () => {
    const r = await client.callTool({ name: "generate_schema", arguments: { source: simple } });
    expect(r.isError).toBeFalsy();
  });

  it("diff_models", async () => {
    const r = await client.callTool({
      name: "diff_models",
      arguments: { base: simple, incoming: simpleModified },
    });
    expect(r.isError).toBeFalsy();
  });

  it("generate_diagram", async () => {
    const r = await client.callTool({
      name: "generate_diagram",
      arguments: { source: simple, annotate: false },
    });
    expect(r.isError).toBeFalsy();
  });

  it("import_model", async () => {
    const r = await client.callTool({
      name: "import_model",
      arguments: {
        source: "CREATE TABLE widgets (id INT PRIMARY KEY, name VARCHAR(100));",
        format: "ddl",
      },
    });
    expect(r.isError).toBeFalsy();
  });

  it("merge_models", async () => {
    const r = await client.callTool({
      name: "merge_models",
      arguments: { base: simple, incoming: simple },
    });
    expect(r.isError).toBeFalsy();
  });

  it("export_model", async () => {
    const r = await client.callTool({
      name: "export_model",
      arguments: { source: simple, format: "ddl" },
    });
    expect(r.isError).toBeFalsy();
  });

  it("describe_domain", async () => {
    const r = await client.callTool({ name: "describe_domain", arguments: { source: simple } });
    expect(r.isError).toBeFalsy();
  });

  it("query_model", async () => {
    const r = await client.callTool({
      name: "query_model",
      arguments: { source: simple, query: "stats" },
    });
    expect(r.isError).toBeFalsy();
  });

  it("lineage_status", async () => {
    const r = await client.callTool({ name: "lineage_status", arguments: { source: simple } });
    expect(r.isError).toBeFalsy();
  });

  it("impact_analysis", async () => {
    const r = await client.callTool({
      name: "impact_analysis",
      arguments: { source: simple, elementId: "ot-customer" },
    });
    expect(r.isError).toBeFalsy();
  });

  it("gym_list", async () => {
    const r = await client.callTool({ name: "gym_list", arguments: {} });
    expect(r.isError).toBeFalsy();
  });

  it("gym_check", async () => {
    const r = await client.callTool({
      name: "gym_check",
      arguments: { exercise: "customer-order", source: gymReference },
    });
    expect(r.isError).toBeFalsy();
  });

  it("analyze_repository", async () => {
    const r = await client.callTool({
      name: "analyze_repository",
      arguments: { repo: fixtures, profileOnly: true },
    });
    expect(r.isError).toBeFalsy();
  });

  // No LLM provider is configured in this test environment: these two
  // fall through to the ollama default and fail against a local server
  // that isn't running. That still exercises the registered wrapper and
  // its error path -- the SDK turns the thrown error into isError: true
  // rather than a transport crash, which is what these confirm.
  it("import_transcript (no provider configured -> reported as a tool error)", async () => {
    const r = await client.callTool({
      name: "import_transcript",
      arguments: { transcript: "A customer places an order." },
    });
    expect(r.isError).toBe(true);
  }, 20_000);

  it("review_model (no provider configured -> reported as a tool error)", async () => {
    const r = await client.callTool({ name: "review_model", arguments: { source: simple } });
    expect(r.isError).toBe(true);
  }, 20_000);

  it("lists resource templates and the static resource", async () => {
    const [{ resources }, { resourceTemplates }] = await Promise.all([
      client.listResources(),
      client.listResourceTemplates(),
    ]);
    const uris = [...resources.map((r) => r.uri), ...resourceTemplates.map((t) => t.uriTemplate)];
    expect(uris).toContain("orm-schema://json-schema");
    expect(uris).toContain("orm-model://{+path}");
    expect(uris).toContain("reasoning-trail://{+path}");
  });

  it("reads orm-schema://json-schema", async () => {
    const r = await client.readResource({ uri: "orm-schema://json-schema" });
    const text = r.contents[0]?.text as string;
    expect(text).toContain("$schema");
  });

  it("reads orm-model://{path}", async () => {
    const r = await client.readResource({ uri: `orm-model://${simple}` });
    const text = r.contents[0]?.text as string;
    expect(JSON.parse(text)._name).toBe("Simple Test");
  });

  it("reads reasoning-trail://{path}", async () => {
    const r = await client.readResource({ uri: `reasoning-trail://${simple}` });
    const text = r.contents[0]?.text as string;
    expect(JSON.parse(text).anchors).toBeDefined();
  });

  it("renders the analyze-domain prompt", async () => {
    const r = await client.getPrompt({
      name: "analyze-domain",
      arguments: { transcript: "A customer places orders for products." },
    });
    expect(r.messages.length).toBeGreaterThan(0);
  });

  it("renders the review-model prompt", async () => {
    const r = await client.getPrompt({ name: "review-model", arguments: { filePath: simple } });
    expect(r.messages.length).toBeGreaterThan(0);
  });

  it("validates the object form of `source` through the zod schema", async () => {
    const r = await client.callTool({
      name: "validate_model",
      arguments: { source: { path: simple } },
    });
    expect(r.isError).toBeFalsy();
  });

  it("rejects a `source` object with neither path nor content", async () => {
    const r = await client.callTool({
      name: "validate_model",
      arguments: { source: {} },
    });
    expect(r.isError).toBe(true);
  });
});
