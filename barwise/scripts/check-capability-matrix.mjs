#!/usr/bin/env node
/**
 * check:capability-matrix -- the capability matrix in the root CLAUDE.md
 * against what each surface registers
 * (docs/specs/capability-matrix-check.spec.md; the rules are
 * docs/adr/surface-capability-parity.md).
 *
 * Twice the matrix said something false for the life of the claim,
 * because nothing compared it with the code (barwise-988, barwise-1005).
 * The pinned tool lists in the MCP and VS Code tests are copies of the
 * registrations; this reads the registrations themselves -- the CLI's
 * commander tree, the MCP server's listTools, VS Code's `contributes`
 * and the commands its extension registers -- so it cannot pass where a
 * list was updated and the matrix was not.
 *
 * scripts/lib/capability-map.json names, per row and surface, what would
 * carry the row's reach. A surface is reached when every name is
 * registered; the cell must say so. A name is given for a `no` surface
 * too, so a gap that closes without the matrix noticing is a finding.
 *
 * Findings, exit 1:
 *   - a matrix row with no map entry, or a map entry with no row;
 *   - a Divergence cell outside the ADR's vocabulary: `none` on a row
 *     with a `no`, `not yet` naming no workstream or issue, `deliberate`
 *     with no reason, or any other first word;
 *   - a cell that disagrees with the registrations;
 *   - a registration no row names and `unlisted` does not excuse (a
 *     command path is covered by any row naming it or an ancestor, which
 *     is the matrix's own granularity: `lineage show` sits under the
 *     `lineage` row, as the ADR says);
 *   - a VS Code palette command contributed and not registered, or
 *     registered and neither contributed nor unlisted.
 * Refusals, exit 2 (docs/adr/gate-refusal-contract.md): the matrix or
 * the map would not read, a surface's build is missing, a build is older
 * than its source (a stale local dist answers for code that is not
 * there), or the MCP server would not list its tools. A finding outranks
 * a refusal.
 *
 * `--static` checks only what needs no build -- the rows against the map
 * and the Divergence vocabulary -- for CI's docs-only path. A docs-only
 * change cannot touch the map or the registrations, so that subset is
 * the whole question there. Only the full run is the ADR's enforcer.
 *
 * Usage: node scripts/check-capability-matrix.mjs [--static] [--root <repo>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SURFACES = ["cli", "mcp", "vscode"];
const MATRIX_HEAD = /^\|\s*Capability\s*\|\s*CLI\s*\|\s*MCP\s*\|\s*VS Code\s*\|\s*Divergence\s*\|/;

/** The matrix rows of the root CLAUDE.md, or throws when there is none. */
export function readMatrix(claudeMd) {
  const lines = claudeMd.split("\n");
  const at = lines.findIndex((l) => MATRIX_HEAD.test(l));
  if (at < 0) throw new Error("the root CLAUDE.md has no capability matrix header");
  const rows = [];
  for (const line of lines.slice(at + 2)) {
    if (!line.startsWith("|")) break;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5) throw new Error(`a matrix row has ${cells.length} cells: ${line}`);
    const [capability, cli, mcp, vscode, divergence] = cells;
    rows.push({ capability, cells: { cli, mcp, vscode }, divergence });
  }
  if (rows.length === 0) throw new Error("the capability matrix has no rows");
  return rows;
}

/** What is wrong with a Divergence cell, or null. */
export function divergenceProblem(row) {
  const d = row.divergence;
  const anyNo = SURFACES.some((s) => row.cells[s] === "no");
  if (/^none\b/.test(d)) return anyNo ? "reads `none` on a row with a `no`" : null;
  if (/^deliberate( \(owner\))?:\s*\S/.test(d)) return null;
  if (/^deliberate\b/.test(d)) return "reads `deliberate` with no reason after a colon";
  if (/^not yet:/.test(d)) {
    return /\bWS\d|\bbarwise-[a-z0-9]/.test(d)
      ? null
      : "reads `not yet` naming no workstream (WS<n>) or issue";
  }
  return `starts with neither none, deliberate nor not yet: "${d.slice(0, 40)}"`;
}

/** Findings that need no build: rows against the map, and the labels. */
export function staticFindings(rows, map) {
  const out = [];
  const keys = new Set(Object.keys(map.rows));
  for (const row of rows) {
    for (const s of SURFACES) {
      if (!["yes", "no"].includes(row.cells[s])) {
        out.push(`row "${row.capability}": the ${s} cell reads "${row.cells[s]}", not yes or no`);
      }
    }
    if (!keys.has(row.capability)) {
      out.push(`row "${row.capability}" has no entry in scripts/lib/capability-map.json`);
    }
    const problem = divergenceProblem(row);
    if (problem) out.push(`row "${row.capability}": its Divergence ${problem}`);
  }
  const named = new Set(rows.map((r) => r.capability));
  for (const key of keys) {
    if (!named.has(key)) out.push(`capability-map.json names "${key}", which no matrix row is`);
  }
  return out;
}

/** True when a surface's registrations include this map name. */
export function registers(surface, reg, name) {
  if (surface === "cli") {
    const [path, option] = name.split(/ (?=--)/);
    const options = reg.cli.get(path);
    return options !== undefined && (option === undefined || options.has(option));
  }
  if (surface === "vscode" && !name.startsWith("barwise_")) return reg.vscode.palette.has(name);
  const [tool, ...props] = name.split(".");
  let schema = surface === "mcp" ? reg.mcp.get(tool) : reg.vscode.tools.get(tool);
  for (const p of props) schema = schema?.properties?.[p];
  return schema !== undefined;
}

/** Findings that need the registrations. */
export function registrationFindings(rows, map, reg) {
  const out = [];
  for (const row of rows) {
    const entry = map.rows[row.capability];
    if (!entry) continue;
    for (const s of SURFACES) {
      const names = entry[s];
      const reached = Array.isArray(names) && names.every((n) => registers(s, reg, n));
      const says = row.cells[s] === "yes";
      if (reached === says) continue;
      if (says) {
        const missing = (names ?? []).filter((n) => !registers(s, reg, n));
        out.push(
          `row "${row.capability}": ${s} reads yes, but ${
            names ? `${missing.join(", ")} is not registered` : "the map names nothing there"
          }`,
        );
      } else {
        out.push(
          `row "${row.capability}": ${s} reads no, but ${names.join(", ")} is registered; `
            + "a gap closed without the matrix",
        );
      }
    }
  }

  // Every registration is some row's, or unlisted with a reason.
  // The thing a name registers: a CLI path without its option, a tool
  // without its input, a palette command whole.
  const subject = (s, n) => {
    if (s === "cli") return n.split(/ (?=--)/)[0];
    if (s === "vscode" && !n.startsWith("barwise_")) return n;
    return n.split(".")[0];
  };
  const namedBy = (s) =>
    Object.values(map.rows).flatMap((e) => e[s] ?? []).map((n) => subject(s, n));
  const cliNamed = namedBy("cli");
  const paths = [...reg.cli.keys()];
  for (const path of paths) {
    // A group (`project`, `prompt`) is reached through its subcommands,
    // each of which is checked on its own.
    if (paths.some((q) => q.startsWith(path + " "))) continue;
    const covered = cliNamed.some((n) => path === n || path.startsWith(n + " "));
    if (!covered) out.push(`CLI command "${path}" is in no matrix row`);
  }
  const mcpNamed = new Set(namedBy("mcp"));
  for (const tool of reg.mcp.keys()) {
    if (!mcpNamed.has(tool)) out.push(`MCP tool "${tool}" is in no matrix row`);
  }
  const vsNamed = new Set(namedBy("vscode"));
  const unlisted = map.unlisted?.vscode ?? {};
  const vsAll = [
    ...reg.vscode.tools.keys(),
    ...reg.vscode.palette,
    ...reg.vscode.registered,
    ...reg.vscode.other,
  ];
  for (const id of new Set(vsAll)) {
    if (!vsNamed.has(id) && !(id in unlisted)) out.push(`VS Code "${id}" is in no matrix row`);
  }
  for (const id of reg.vscode.palette) {
    if (!reg.vscode.registered.has(id)) {
      out.push(`VS Code palette command "${id}" is contributed and never registered`);
    }
  }
  for (const id of reg.vscode.registered) {
    if (!reg.vscode.palette.has(id) && !(id in unlisted)) {
      out.push(`VS Code command "${id}" is registered, not contributed, and not unlisted`);
    }
  }
  for (const id of Object.keys(unlisted)) {
    if (!vsAll.includes(id)) {
      out.push(`capability-map.json unlists "${id}", which VS Code does not have`);
    }
  }
  return out;
}

/** Every file under a directory, recursively. */
function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(join(dir, e.name)) : [join(dir, e.name)]
  );
}

const newest = (dir) => Math.max(...filesUnder(dir).map((f) => statSync(f).mtimeMs));

/** Throws when a package's dist is missing or older than its src. */
function assertBuilt(root, pkg) {
  const dist = join(root, "packages", pkg, "dist");
  if (!existsSync(dist)) throw new Error(`packages/${pkg}/dist is missing; run npm run build`);
  if (newest(join(root, "packages", pkg, "src")) > newest(dist)) {
    throw new Error(`packages/${pkg}/dist is older than its src; run npm run build`);
  }
}

/** The VS Code registrations: contributes, plus the extension's registerCommand calls. */
export function readVscode(root) {
  const dir = join(root, "packages", "vscode");
  const c = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).contributes ?? {};
  const tools = new Map((c.languageModelTools ?? []).map((t) => [t.name, t.inputSchema ?? {}]));
  const palette = new Set((c.commands ?? []).map((x) => x.command));
  const registered = new Set();
  for (const f of filesUnder(join(dir, "src"))) {
    if (!/\.tsx?$/.test(f)) continue;
    for (const m of readFileSync(f, "utf8").matchAll(/registerCommand\(\s*["'`]([^"'`]+)["'`]/g)) {
      registered.add(m[1]);
    }
  }
  const other = [
    ...(c.chatParticipants ?? []).map((p) => `chat:${p.id}`),
    ...(c.mcpServerDefinitionProviders ?? []).map((p) => `mcp-provider:${p.id}`),
  ];
  return { tools, palette, registered, other };
}

/** CLI command paths, each with its long options, from the built program. */
async function readCli(root) {
  assertBuilt(root, "cli");
  const { createProgram } = await import(
    pathToFileURL(join(root, "packages/cli/dist/cli.js")).href
  );
  const program = await createProgram();
  const out = new Map();
  const walk = (cmd, path) => {
    for (const sub of cmd.commands) {
      const p = [...path, sub.name()];
      out.set(p.join(" "), new Set(sub.options.map((o) => o.long).filter(Boolean)));
      walk(sub, p);
    }
  };
  walk(program, []);
  return out;
}

/** MCP tools with their input schemas, from the built server. */
async function readMcp(root) {
  assertBuilt(root, "mcp");
  const { createServer } = await import(
    pathToFileURL(join(root, "packages/mcp/dist/server.js")).href
  );
  const sdk = join(root, "node_modules/@modelcontextprotocol/sdk/dist/esm");
  const { Client } = await import(pathToFileURL(join(sdk, "client/index.js")).href);
  const { InMemoryTransport } = await import(pathToFileURL(join(sdk, "inMemory.js")).href);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await createServer().connect(serverSide);
  const client = new Client({ name: "check-capability-matrix", version: "0" });
  await client.connect(clientSide);
  try {
    const { tools } = await client.listTools();
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error("the MCP server listed no tools");
    }
    return new Map(tools.map((t) => [t.name, t.inputSchema ?? {}]));
  } finally {
    await client.close();
  }
}

async function main(argv) {
  const say = (s) => console.error(`check:capability-matrix: ${s}`);
  const at = argv.indexOf("--root");
  const root = at >= 0
    ? resolve(argv[at + 1])
    : resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const onlyStatic = argv.includes("--static");

  let rows;
  let map;
  try {
    rows = readMatrix(readFileSync(join(root, "..", "CLAUDE.md"), "utf8"));
    map = JSON.parse(readFileSync(join(root, "scripts/lib/capability-map.json"), "utf8"));
    if (!map.rows || typeof map.rows !== "object") {
      throw new Error("capability-map.json has no rows");
    }
  } catch (e) {
    say(`cannot answer: ${e.message}`);
    return 2;
  }

  const findings = staticFindings(rows, map);
  let refusal = null;
  if (!onlyStatic) {
    try {
      const reg = { cli: await readCli(root), mcp: await readMcp(root), vscode: readVscode(root) };
      findings.push(...registrationFindings(rows, map, reg));
    } catch (e) {
      refusal = e.message;
    }
  }

  for (const f of findings) say(f);
  if (findings.length > 0) {
    say(
      `FAIL -- ${findings.length} finding(s). Update the matrix in the root CLAUDE.md `
        + "and scripts/lib/capability-map.json together (docs/adr/surface-capability-parity.md).",
    );
    if (refusal) say(`also could not read the registrations: ${refusal}`);
    return 1;
  }
  if (refusal) {
    say(`cannot answer: ${refusal}`);
    return 2;
  }
  say(
    onlyStatic
      ? `${rows.length} rows agree with capability-map.json and use the Divergence vocabulary (static half). OK`
      : `${rows.length} rows agree with what the CLI, MCP server and VS Code extension register. OK`,
  );
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
