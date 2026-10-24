/**
 * The shared spec reader and check:spec-touches
 * (docs/specs/plan-scope-check.spec.md, WS2).
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { header, isWiring, namedPaths, touches } from "../lib/spec-reader.mjs";

const GATE = join(dirname(fileURLToPath(import.meta.url)), "..", "check-spec-touches.mjs");

test("header reads the header block only, across wrapped lines", () => {
  const text = [
    "# Title",
    "",
    "Status: Draft -- no workstream implemented",
    "Tracking: barwise-1, barwise-2,",
    "barwise-3",
    "",
    "## Body",
    "",
    "```text",
    "Touches: quoted/in/a/code-block.ts",
    "```",
  ].join("\n");
  assert.equal(header(text, "Tracking"), "barwise-1, barwise-2,\nbarwise-3");
  assert.equal(header(text, "Touches"), undefined, "a field in the body is not the spec's own");
});

test("touches parses entries and their marks", () => {
  const text = "# T\n\nTouches: a/b.ts, +a/new.mjs,\n-plan.md, x/\n\n## Body\n";
  assert.deepEqual(touches(text), [
    { path: "a/b.ts", mark: "" },
    { path: "a/new.mjs", mark: "+" },
    { path: "plan.md", mark: "-" },
    { path: "x/", mark: "" },
  ]);
  assert.equal(touches("# T\n\nStatus: Draft\n"), undefined);
});

test("isWiring covers the shared files and directories, nothing else", () => {
  for (
    const p of [".github/workflows/ci.yml", "package.json", "barwise/package.json", "CLAUDE.md"]
  ) {
    assert.equal(isWiring(p), true, p);
  }
  for (
    const p of [
      "barwise/packages/core/CLAUDE.md",
      "barwise/scripts/x.mjs",
      "barwise/package.json.bak",
    ]
  ) {
    assert.equal(isWiring(p), false, p);
  }
});

test("namedPaths keeps the audit's defaults and widens per option", () => {
  const known = new Set([
    "barwise/scripts/a.mjs",
    "barwise/packages/core/src/index.ts",
    "barwise/packages/cli/",
    ".claude/skills/x/SKILL.md",
    "plan.md",
  ]);
  const exists = (p) => known.has(p) || known.has(`${p}/`);
  const text = "`scripts/a.mjs` `core/src/index.ts` `barwise/packages/cli/` "
    + "`.claude/skills/x/SKILL.md` `plan.md`";
  assert.deepEqual(
    namedPaths(text, exists),
    ["barwise/scripts/a.mjs"],
    "defaults: code files, no barrels",
  );
  assert.ok(
    namedPaths(text, exists, { barrels: true }).includes("barwise/packages/core/src/index.ts"),
  );
  assert.ok(namedPaths(text, exists, { dirs: true }).includes("barwise/packages/cli/"));
  assert.ok(namedPaths(text, exists, { anyExtension: true }).includes(".claude/skills/x/SKILL.md"));
  assert.ok(
    !namedPaths(text, exists, { anyExtension: true }).includes("plan.md"),
    "bare is its own option",
  );
  assert.ok(namedPaths(text, exists, { anyExtension: true, bare: true }).includes("plan.md"));
});

/** A fixture: a specs directory and a tracked-file list. */
function gateFixture(specs, tracked) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-touches-"));
  mkdirSync(join(dir, "specs"));
  for (const [name, body] of Object.entries(specs)) writeFileSync(join(dir, "specs", name), body);
  writeFileSync(join(dir, "tracked.txt"), tracked.join("\n"));
  const run = (...extra) =>
    spawnSync(process.execPath, [
      GATE,
      "--specs",
      join(dir, "specs"),
      "--tracked",
      join(dir, "tracked.txt"),
      ...extra,
    ], {
      encoding: "utf8",
    });
  return { dir, run, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const spec = (touchesLine) => `# S\n\nStatus: Draft\nTouches: ${touchesLine}\n\n## Body\n`;

test("check:spec-touches passes resolving, planned-new and planned-deleted entries", () => {
  const f = gateFixture(
    {
      "a.spec.md": spec("barwise/x.ts, barwise/dir/, barwise/*/y.ts, +barwise/new.ts, -gone.md"),
      "b.spec.md": "# B\n\nStatus: Draft\n",
    },
    ["barwise/x.ts", "barwise/dir/z.ts", "barwise/p/y.ts"],
  );
  try {
    const r = f.run();
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 spec\(s\) declare Touches:, every entry resolves/);
  } finally {
    f.done();
  }
});

test("check:spec-touches fails on an unmarked entry that names nothing tracked", () => {
  const f = gateFixture({
    "a.spec.md": spec("barwise/x.ts, barwise/moved.ts, barwise/nodir/, barwise/*/none.ts"),
  }, ["barwise/x.ts"]);
  try {
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /3 Touches: entries name nothing tracked/);
    assert.match(r.stderr, /a\.spec\.md: barwise\/moved\.ts/);
    assert.match(r.stderr, /a\.spec\.md: barwise\/nodir\//);
    assert.match(r.stderr, /a\.spec\.md: barwise\/\*\/none\.ts/);
  } finally {
    f.done();
  }
});

test("check:spec-touches refuses an empty tracked list, and a flag with no value", () => {
  const f = gateFixture({ "a.spec.md": spec("barwise/x.ts") }, []);
  try {
    let r = f.run();
    assert.equal(r.status, 2);
    assert.match(r.stderr, /tracked-file list is empty/);
    r = spawnSync(process.execPath, [GATE, "--tracked"], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--tracked needs a value/);
  } finally {
    f.done();
  }
});

test("check:spec-touches passes on the real tree, with no overrides", () => {
  const r = spawnSync(process.execPath, [GATE], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
