/**
 * The lane tells a spilled MCP result from an answer by the notice the
 * server opens it with. The lane imports nothing from @barwise, so the
 * pattern is a copy of the server's text; this reads the server's source
 * so a change to the notice fails here instead of grading previews as
 * parity failures.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MCP_SPILL_NOTICE } from "../lib/steps.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  resolve(here, "../../packages/mcp/src/workspace/response.ts"),
  "utf8",
);

test("the server's spill notice still has the two parts the pattern reads", () => {
  assert.ok(
    source.includes("`[barwise] Output is ${formatBytes(bytes)} (${lines.length} lines) `"),
  );
  assert.ok(source.includes('"-- too large to return inline."'));
});

test("the pattern matches a spill notice and nothing that is an answer", () => {
  const notice = "[barwise] Output is 39.2 KB (309 lines) -- too large to return inline.\n"
    + "Full content written to: /tmp/x.sql";
  assert.match(notice, MCP_SPILL_NOTICE);
  assert.doesNotMatch("-- Table: patient\nCREATE TABLE patient (", MCP_SPILL_NOTICE);
  assert.doesNotMatch("Each Patient has some MRN. [barwise] Output is", MCP_SPILL_NOTICE);
});
