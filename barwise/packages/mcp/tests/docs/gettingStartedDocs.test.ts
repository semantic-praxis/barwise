/**
 * The MCP tool names the user docs cite, against the tools this server
 * registers.
 *
 * Three copies of the tool list live in markdown: the table at the end of
 * the MCP getting-started guide, the "MCP tool" column of the workflow table
 * in GETTING_STARTED.md, and the per-tool sections of docs/MCP.md. Each is
 * read here and compared with the live registration, so adding, renaming or
 * dropping a tool fails until the docs say the same (barwise-jk7,
 * docs/specs/getting-started-guides.spec.md). `serverSpawn.test.ts` pins the
 * list itself; this pins what users are told about it.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { createServer } from "../../src/server.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const read = (file: string): string => readFileSync(`${REPO_ROOT}${file}`, "utf8");

/** The lines of the markdown section that starts at `heading`. */
function section(markdown: string, heading: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start < 0) throw new Error(`no "${heading}" heading`);
  const level = /^#+/.exec(heading)![0].length;
  const end = lines.findIndex(
    (l, i) => i > start && /^#+ /.test(l) && /^#+/.exec(l)![0].length <= level,
  );
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

/** Cell `column` of each body row of the first table in `lines`. */
function tableColumn(lines: string[], column: number): string[] {
  const rows = lines.filter((l) => l.trimStart().startsWith("|"));
  return rows.slice(2).map((r) => r.split("|")[column + 1]!.trim());
}

describe("MCP tool names in the user docs", () => {
  let registered: string[];

  beforeAll(async () => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "docs-check", version: "0.0.0" });
    await Promise.all([client.connect(clientTransport), createServer().connect(serverTransport)]);
    registered = (await client.listTools()).tools.map((t) => t.name).sort();
    await client.close();
  });

  it("the MCP guide's tool table lists exactly the registered tools", () => {
    const cells = tableColumn(
      section(read("barwise/docs/getting-started/mcp.md"), "## The tools"),
      0,
    );
    const names = cells.map((c) => c.replace(/`/g, "")).sort();
    expect(names).toEqual(registered);
  });

  it("the workflow table in GETTING_STARTED.md names only registered tools", () => {
    const cells = tableColumn(
      section(read("GETTING_STARTED.md"), "## The workflow, surface by surface"),
      2,
    );
    const cited = cells.flatMap((c) => [...c.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]!));
    // A table that cites nothing would pass the next line vacuously.
    expect(cited.length).toBeGreaterThan(10);
    expect(cited.filter((n) => !registered.includes(n))).toEqual([]);
  });

  it("docs/MCP.md has one reference section per registered tool", () => {
    const headings = section(read("barwise/docs/MCP.md"), "## Tools Reference")
      .filter((l) => l.startsWith("### "))
      .map((l) => l.slice(4).trim())
      .sort();
    expect(headings).toEqual(registered);
  });
});
