/**
 * The built MCP server, started over stdio, offers every registered format
 * (docs/specs/boot-path-registration.spec.md, workstream 2).
 *
 * `import_model`'s `format` enum and `export_model`'s description are built
 * from the registry when the tool modules load, so they show what the server
 * held after it started. The reference set comes from a second fresh process
 * that calls the three connectors' register functions.
 *
 * This is a weak check and says so. Three MCP modules register, and
 * `dbt` is registered by two of them, so deleting `registerDbtFormats()` from
 * one module leaves this green on purpose; it goes red when every module on
 * the path loses the connector. VS Code inherits this set through
 * `@barwise/mcp` and has no boot test of its own (connector-packages.md).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const run = promisify(execFile);
const PKG = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SERVER_ENTRY = resolve(PKG, "dist/index.js");

const REFERENCE_PROBE = `
const core = await import("@barwise/core");
for (const pkg of ["@barwise/formats", "@barwise/dbt", "@barwise/code-analysis"]) {
  const mod = await import(pkg);
  for (const fn of Object.keys(mod).filter((k) => /^register\\w*Formats$/.test(k))) mod[fn]();
}
console.log(JSON.stringify({
  importers: core.listImporters().map((d) => d.name),
  exporters: core.listExporters().map((d) => d.name),
}));
`;

describe("MCP server formats once booted", () => {
  let client: Client;
  let reference: { importers: string[]; exporters: string[]; };

  beforeAll(async () => {
    expect(existsSync(SERVER_ENTRY), `built entry missing: ${SERVER_ENTRY}`).toBe(true);
    const { stdout } = await run(process.execPath, ["--input-type=module", "-e", REFERENCE_PROBE], {
      cwd: PKG,
      timeout: 60_000,
    });
    reference = JSON.parse(stdout);
    // An empty reference would make both assertions below vacuous.
    expect(reference.importers.length).toBeGreaterThanOrEqual(9);
    expect(reference.exporters.length).toBeGreaterThanOrEqual(6);
    client = new Client({ name: "boot-registration", version: "0.0.0" });
    await client.connect(
      new StdioClientTransport({ command: process.execPath, args: [SERVER_ENTRY] }),
    );
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("offers every importer in import_model's format enum [adr:connector-packages#explicit-registration]", async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "import_model")!.inputSchema as {
      properties: { format: { enum: string[]; }; };
    };
    expect([...schema.properties.format.enum].sort()).toEqual([...reference.importers].sort());
  });

  it("names every exporter in export_model's format description [adr:connector-packages#explicit-registration]", async () => {
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === "export_model")!.inputSchema as {
      properties: { format: { description: string; }; };
    };
    const listed = /Available: (.+)$/.exec(schema.properties.format.description)?.[1];
    expect(listed?.split(", ").sort()).toEqual([...reference.exporters].sort());
  });
});
