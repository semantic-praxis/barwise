#!/usr/bin/env node
/**
 * Real-use shakedown for the barwise MCP server. Spawns the built server
 * bundle over stdio with the official MCP SDK client, then lists its
 * tools / resources / prompts and calls a representative subset against the
 * shipped examples and ./fixtures. This is a bug-hunting harness and a
 * parity check against the CLI -- the same model should yield the same
 * findings on either surface.
 *
 * Usage:
 *   node test-plan/mcp-checks.mjs
 *
 * Environment:
 *   MCP_SERVER  Override the server command (default:
 *               "node <repo>/packages/mcp/dist/bundle/index.cjs").
 *
 * Exit code: 0 if every check passed, 1 if any failed, 2 on setup error.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(SCRIPT_DIR);
const FIX = join(SCRIPT_DIR, "fixtures");
const EX = join(ROOT, "examples");
const BUNDLE = join(ROOT, "packages/mcp/dist/bundle/index.cjs");

const CLEAN = join(EX, "transcripts/clinic-appointments.orm.yaml");
const SHOWCASE = join(FIX, "constraints-showcase.orm.yaml");
const EU_OK = join(FIX, "external-uniqueness.orm.yaml");
const EU_BAD = join(FIX, "external-uniqueness-violation.orm.yaml");

let command = "node";
let args = [BUNDLE];
if (process.env.MCP_SERVER) {
  const parts = process.env.MCP_SERVER.split(" ");
  command = parts[0];
  args = parts.slice(1);
} else if (!existsSync(BUNDLE)) {
  console.error(`MCP server bundle not found at ${BUNDLE}.`);
  console.error("Build it:  npm run --workspace=@barwise/mcp bundle");
  console.error('Or set MCP_SERVER to another command (e.g. "barwise-mcp").');
  process.exit(2);
}

const tty = process.stdout.isTTY;
const G = tty ? "\x1b[32m" : "", R = tty ? "\x1b[31m" : "", D = tty ? "\x1b[2m" : "", N = tty ? "\x1b[0m" : "";
const Y = tty ? "\x1b[33m" : "";
let pass = 0, fail = 0, skipped = 0;
const ok = (m) => { pass++; console.log(`  ${G}PASS${N} ${m}`); };
const bad = (m, d) => { fail++; console.log(`  ${R}FAIL${N} ${m}\n     ${D}${d}${N}`); };
const skip = (m, d) => { skipped++; console.log(`  ${Y}SKIP${N} ${m}\n     ${D}${d}${N}`); };
const section = (m) => console.log(`\n${D}== ${m} ==${N}`);
const hasLlm = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.OLLAMA_HOST);
const assert = (cond, m, detail) => cond ? ok(m) : bad(m, detail ?? "assertion failed");

// Pull the single text block out of a tool result.
const textOf = (res) => (res?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");

const client = new Client({ name: "barwise-test-plan", version: "1.0.0" }, { capabilities: {} });
const transport = new StdioClientTransport({ command, args });

try {
  await client.connect(transport);

  section("Discovery");
  const tools = (await client.listTools()).tools.map((t) => t.name);
  const wantTools = [
    "validate_model", "verbalize_model", "query_model", "review_model",
    "export_model", "diff_models", "generate_diagram", "generate_schema",
    "describe_domain", "import_transcript",
  ];
  const missing = wantTools.filter((t) => !tools.includes(t));
  assert(missing.length === 0, `tools/list exposes the expected tools (${tools.length})`, `missing: ${missing.join(", ")}`);

  const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);
  const statics = (await client.listResources()).resources.map((r) => r.uri);
  const schemes = [...templates, ...statics].join(" ");
  for (const s of ["orm-model://", "orm-schema://", "reasoning-trail://"]) {
    assert(schemes.includes(s), `resource scheme present: ${s}`, `not in: ${schemes}`);
  }

  const prompts = (await client.listPrompts()).prompts.map((p) => p.name);
  assert(prompts.includes("review-model"), "prompts/list exposes review-model", `got: ${prompts.join(", ")}`);

  section("Tools -- core capabilities");
  let r = await client.callTool({ name: "validate_model", arguments: { source: CLEAN } });
  let parsed = JSON.parse(textOf(r));
  assert(parsed.valid === true && parsed.errorCount === 0, "validate_model: clean model is valid", textOf(r).slice(0, 200));

  r = await client.callTool({ name: "verbalize_model", arguments: { source: SHOWCASE, counterexamples: true } });
  assert(/Rules out:/i.test(textOf(r)), "verbalize_model --counterexamples emits probes", textOf(r).slice(0, 200));

  r = await client.callTool({ name: "query_model", arguments: { source: CLEAN, query: "anchors" } });
  assert(/anchor|reference mode/i.test(textOf(r)), "query_model anchors returns anchors", textOf(r).slice(0, 200));

  r = await client.callTool({ name: "export_model", arguments: { source: CLEAN, format: "ddl" } });
  assert(!r.isError && textOf(r).length > 0, "export_model ddl produces output", textOf(r).slice(0, 200));

  r = await client.callTool({
    name: "diff_models",
    arguments: {
      base: join(ROOT, "packages/mcp/tests/fixtures/simple.orm.yaml"),
      incoming: join(ROOT, "packages/mcp/tests/fixtures/simple-modified.orm.yaml"),
    },
  });
  assert(!r.isError && textOf(r).length > 0, "diff_models returns a diff", textOf(r).slice(0, 200));

  section("Tools -- external uniqueness (WS4c) + CLI parity");
  r = await client.callTool({ name: "validate_model", arguments: { source: EU_OK } });
  parsed = JSON.parse(textOf(r));
  assert(parsed.valid === true, "validate_model: clean external-uniqueness model is valid", textOf(r).slice(0, 200));

  r = await client.callTool({ name: "validate_model", arguments: { source: EU_BAD } });
  parsed = JSON.parse(textOf(r));
  const euErr = parsed.valid === false && JSON.stringify(parsed.errors).match(/external uniqueness/i);
  assert(!!euErr, "validate_model: shared combination reports external-uniqueness violation", textOf(r).slice(0, 300));

  section("Tools -- LLM-powered (need a provider; skipped otherwise)");
  if (hasLlm) {
    r = await client.callTool({ name: "review_model", arguments: { source: CLEAN } }, undefined, { timeout: 120000 });
    assert(!r.isError && textOf(r).length > 0, "review_model returns a review", textOf(r).slice(0, 200));
    r = await client.callTool(
      { name: "import_transcript", arguments: { source: join(EX, "transcripts/library-system.md") } },
      undefined,
      { timeout: 180000 },
    );
    assert(!r.isError && textOf(r).length > 0, "import_transcript produces a draft model", textOf(r).slice(0, 200));
  } else {
    skip("review_model / import_transcript", "no LLM provider env (ANTHROPIC_API_KEY / OPENAI_API_KEY / OLLAMA_HOST)");
  }

  section("Resources");
  r = await client.readResource({ uri: "orm-schema://json-schema" });
  assert((r.contents ?? []).length > 0, "orm-schema://json-schema serves the JSON Schema", JSON.stringify(r).slice(0, 200));

  r = await client.readResource({ uri: `orm-model://${CLEAN}` });
  assert((r.contents ?? []).length > 0, "orm-model://{path} serves a deserialized model", JSON.stringify(r).slice(0, 200));

  // No sidecar exists for CLEAN -> expect the anchors-only fallback trail.
  r = await client.readResource({ uri: `reasoning-trail://${CLEAN}` });
  assert((r.contents ?? []).length > 0, "reasoning-trail://{path} serves the anchors-only fallback", JSON.stringify(r).slice(0, 200));

  section("Prompts");
  r = await client.getPrompt({ name: "review-model", arguments: { filePath: CLEAN } });
  assert((r.messages ?? []).length > 0, "review-model prompt renders messages", JSON.stringify(r).slice(0, 200));
} catch (err) {
  bad("harness error", err?.stack ?? String(err));
} finally {
  await client.close().catch(() => {});
}

console.log(`\n${D}----------------------------------------${N}`);
console.log(`Passed: ${G}${pass}${N}   Failed: ${R}${fail}${N}   Skipped: ${Y}${skipped}${N}`);
process.exit(fail === 0 ? 0 : 1);
