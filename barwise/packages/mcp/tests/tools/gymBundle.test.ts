/**
 * The release MCP bundle runs the gym tools (barwise-fbi).
 *
 * Every other gym test calls the handlers on source, and the source was
 * never the problem: learn resolved its catalog from import.meta.url,
 * which esbuild empties in the CJS bundle, so gym_list and gym_check
 * returned a Node path error from the shipped barwise-mcp-2.0.0.cjs.
 * This builds the bundle with the release script and talks to it over
 * stdio as a client would. It builds rather than reusing dist/bundle/:
 * `bundle` is not part of `build`, so a reused bundle would be missing
 * locally or stale (barwise-lh9).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const bundle = join(pkgRoot, "dist/bundle/index.cjs");
const reference = resolve(pkgRoot, "../learn/exercises/customer-order.reference.orm.yaml");

let buildLog = "";
let client: Client;

const text = (r: Awaited<ReturnType<Client["callTool"]>>): string =>
  (r.content as { type: string; text: string; }[])[0]!.text;

describe("MCP release bundle: gym tools", () => {
  beforeAll(async () => {
    // esbuild prints warnings to stderr at logLevel "warning".
    const build = spawnSync(process.execPath, ["esbuild.mjs"], { cwd: pkgRoot, encoding: "utf8" });
    expect(build.status, build.stderr).toBe(0);
    buildLog = build.stdout + build.stderr;
    client = new Client({ name: "gym-bundle", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bundle] }));
  }, 60_000);

  afterAll(async () => {
    await client?.close();
  });

  it("builds without an empty-import-meta warning", () => {
    expect(buildLog).toContain("Bundle complete.");
    expect(buildLog).not.toContain("import.meta");
  });

  it("gym_list lists the packaged exercises", async () => {
    const r = await client.callTool({ name: "gym_list", arguments: {} });
    expect(r.isError, text(r)).toBeFalsy();
    expect(JSON.parse(text(r)).map((e: { id: string; }) => e.id)).toContain("customer-order");
  });

  it("gym_check evaluates a candidate against a packaged exercise", async () => {
    const r = await client.callTool({
      name: "gym_check",
      arguments: { exercise: "customer-order", source: reference },
    });
    expect(r.isError, text(r)).toBeFalsy();
    expect(JSON.parse(text(r))).toMatchObject({ exerciseId: "customer-order", passed: true });
  });
});
