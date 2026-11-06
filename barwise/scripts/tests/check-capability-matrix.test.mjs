/**
 * check:capability-matrix (docs/specs/capability-matrix-check.spec.md, WS1).
 * Each finding is planted red against small registrations built here, and
 * the gate itself is run over a copy of the real matrix and map: the
 * static half passes and goes red on a planted row, and the full run
 * refuses, never passes, when a surface has no build.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  divergenceProblem,
  readMatrix,
  registrationFindings,
  staticFindings,
} from "../check-capability-matrix.mjs";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GATE = join(REPO, "barwise", "scripts", "check-capability-matrix.mjs");
const CLAUDE_MD = readFileSync(join(REPO, "CLAUDE.md"), "utf8");
const MAP = JSON.parse(
  readFileSync(join(REPO, "barwise", "scripts", "lib", "capability-map.json"), "utf8"),
);

const HEAD = "| Capability | CLI | MCP | VS Code | Divergence |\n| --- | --- | --- | --- | --- |\n";
const row = (cap, cli, mcp, vs, div) => `| ${cap} | ${cli} | ${mcp} | ${vs} | ${div} |\n`;

/** One row, `merge`, reached everywhere, with registrations to match. */
function fixture() {
  const rows = readMatrix(HEAD + row("`merge`", "yes", "yes", "yes", "none"));
  const map = {
    rows: {
      "`merge`": {
        cells: ["yes", "yes", "yes"],
        cli: ["merge --output"],
        mcp: ["merge_models.base"],
        vscode: ["barwise_merge_models"],
      },
    },
    unlisted: { vscode: { "barwise.helper": "an editor helper" } },
  };
  const reg = {
    cli: new Map([["merge", new Set(["--output"])]]),
    mcp: new Map([["merge_models", { properties: { base: {} } }]]),
    vscode: {
      tools: new Map([["barwise_merge_models", {}]]),
      palette: new Set(["barwise.helper"]),
      registered: new Set(["barwise.helper"]),
      other: [],
    },
  };
  return { rows, map, reg };
}

test("the real matrix and map agree, and every Divergence is in the vocabulary", () => {
  assert.deepEqual(staticFindings(readMatrix(CLAUDE_MD), MAP), []);
});

test("the fixture is clean, so each case below fails for its own plant", () => {
  const { rows, map, reg } = fixture();
  assert.deepEqual([...staticFindings(rows, map), ...registrationFindings(rows, map, reg)], []);
});

test("a matrix row with no map entry, and a map entry with no row, are findings", () => {
  const { map } = fixture();
  const rows = readMatrix(
    HEAD + row("`merge`", "yes", "yes", "yes", "none")
      + row("`new`", "yes", "no", "no", "deliberate: x"),
  );
  assert.match(staticFindings(rows, map).join("\n"), /row "`new`" has no entry/);
  const lone = readMatrix(HEAD + row("`other`", "yes", "yes", "yes", "none"));
  assert.match(staticFindings(lone, map).join("\n"), /names "`merge`", which no matrix row is/);
});

test("the Divergence vocabulary", () => {
  const r = (div, mcp = "no") => ({
    capability: "x",
    cells: { cli: "yes", mcp, vscode: "yes" },
    divergence: div,
  });
  assert.match(divergenceProblem(r("none")), /`none` on a row with a `no`/);
  assert.equal(divergenceProblem(r("none", "yes")), null);
  assert.match(divergenceProblem(r("not yet: someday")), /no workstream/);
  assert.equal(divergenceProblem(r("not yet: surface-mirroring WS3")), null);
  assert.equal(divergenceProblem(r("not yet: barwise-fbi")), null);
  assert.match(divergenceProblem(r("deliberate")), /no reason/);
  assert.equal(divergenceProblem(r("deliberate (owner): the log is the learner's")), null);
  assert.match(divergenceProblem(r("under review")), /neither none, deliberate nor not yet/);
});

test("a cell reading yes where a mapped name is not registered is a finding", () => {
  const { rows, map, reg } = fixture();
  reg.mcp.delete("merge_models");
  assert.match(
    registrationFindings(rows, map, reg).join("\n"),
    /mcp reads yes, but merge_models.base is not registered/,
  );
});

test("a cell reading no where every mapped name is registered is a finding: a gap closed unrecorded", () => {
  const { map, reg } = fixture();
  const rows = readMatrix(HEAD + row("`merge`", "yes", "yes", "no", "not yet: WS3"));
  assert.match(
    registrationFindings(rows, map, reg).join("\n"),
    /vscode reads no, but barwise_merge_models is registered/,
  );
});

test("an option or input the map names is read, not just its command or tool", () => {
  const { rows, map, reg } = fixture();
  reg.cli.set("merge", new Set());
  assert.match(
    registrationFindings(rows, map, reg).join("\n"),
    /cli reads yes, but merge --output/,
  );
});

test("a registration no row names is a finding on every surface", () => {
  const { rows, map, reg } = fixture();
  reg.cli.set("history", new Set());
  reg.mcp.set("history_model", {});
  reg.vscode.tools.set("barwise_history", {});
  reg.vscode.other.push("chat:barwise.chat");
  const out = registrationFindings(rows, map, reg).join("\n");
  assert.match(out, /CLI command "history" is in no matrix row/);
  assert.match(out, /MCP tool "history_model" is in no matrix row/);
  assert.match(out, /VS Code "barwise_history" is in no matrix row/);
  assert.match(out, /VS Code "chat:barwise.chat" is in no matrix row/);
});

test("a subcommand is covered by a row naming its parent, and a group by its subcommands", () => {
  const { rows, map, reg } = fixture();
  reg.cli.set("merge three", new Set());
  assert.deepEqual(registrationFindings(rows, map, reg), []);
  reg.cli.set("group", new Set());
  reg.cli.set("group child", new Set());
  assert.match(
    registrationFindings(rows, map, reg).join("\n"),
    /"group child" is in no matrix row/,
  );
  assert.doesNotMatch(registrationFindings(rows, map, reg).join("\n"), /"group" is in/);
});

test("a palette command contributed and not registered, or registered and not contributed, is a finding", () => {
  const { rows, map, reg } = fixture();
  reg.vscode.registered.delete("barwise.helper");
  assert.match(
    registrationFindings(rows, map, reg).join("\n"),
    /"barwise.helper" is contributed and never registered/,
  );
  const f = fixture();
  f.reg.vscode.registered.add("barwise.hidden");
  assert.match(
    registrationFindings(f.rows, f.map, f.reg).join("\n"),
    /"barwise.hidden" is registered, not contributed/,
  );
});

/** A tree holding the real matrix and map, and no packages. */
function tree(matrix = CLAUDE_MD) {
  const dir = mkdtempSync(join(tmpdir(), "capability-matrix-"));
  writeFileSync(join(dir, "CLAUDE.md"), matrix);
  mkdirSync(join(dir, "barwise", "scripts", "lib"), { recursive: true });
  writeFileSync(join(dir, "barwise", "scripts", "lib", "capability-map.json"), JSON.stringify(MAP));
  return dir;
}

const run = (dir, ...args) =>
  spawnSync(process.execPath, [GATE, "--root", join(dir, "barwise"), ...args], {
    encoding: "utf8",
  });

test("the gate: --static passes on the real matrix and fails on a planted row", (t) => {
  const dir = tree();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ok = run(dir, "--static");
  assert.equal(ok.status, 0, ok.stderr);
  const bad = tree(CLAUDE_MD.replace("| `merge` ", "| `merged` "));
  t.after(() => rmSync(bad, { recursive: true, force: true }));
  const r = run(bad, "--static");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /row "`merged`" has no entry/);
});

test("the gate refuses, never passes, when a surface has no build", (t) => {
  const dir = tree();
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /cannot answer: packages\/cli\/dist is missing/);
  assert.doesNotMatch(r.stderr, /OK/);
});

test("the gate refuses when the matrix is missing, and a finding outranks a refusal", (t) => {
  const dir = tree("no matrix here\n");
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir);
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /no capability matrix header/);
  const bad = tree(CLAUDE_MD.replace("| `merge` ", "| `merged` "));
  t.after(() => rmSync(bad, { recursive: true, force: true }));
  const both = run(bad);
  assert.equal(both.status, 1, both.stderr);
  assert.match(both.stderr, /also could not read the registrations/);
});

test("--static fails on a cell flipped in the matrix alone, with its Divergence still valid", (t) => {
  const migrate = CLAUDE_MD.split("\n").find((l) => l.startsWith("| `migrate`"));
  const flipped = migrate.replace("| yes | no  | no      |", "| yes | yes | no      |");
  assert.notEqual(flipped, migrate);
  const dir = tree(CLAUDE_MD.replace(migrate, flipped));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const r = run(dir, "--static");
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /row "`migrate`": the mcp cell reads "yes", the map's cells say "no"/);
  assert.doesNotMatch(r.stderr, /Divergence/);
});

test("`not yet` on a row every surface reaches is a finding: the gap closed and the label stayed", () => {
  const r = {
    capability: "x",
    cells: { cli: "yes", mcp: "yes", vscode: "yes" },
    divergence: "not yet: WS3",
  };
  assert.match(divergenceProblem(r), /every surface reaches/);
});
