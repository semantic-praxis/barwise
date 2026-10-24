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
import {
  entryPaths,
  header,
  inSpecCorpus,
  isWiring,
  namedPaths,
  touches,
} from "../lib/spec-reader.mjs";

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
  // A space after the mark is not part of the path.
  assert.deepEqual(touches("# T\n\nTouches: + a/new.mjs, - old.md\n"), [
    { path: "a/new.mjs", mark: "+" },
    { path: "old.md", mark: "-" },
  ]);
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

test("the corpus is tracked specs, archived ones excepted", () => {
  assert.equal(inSpecCorpus("barwise/docs/specs/a.spec.md"), true);
  assert.equal(inSpecCorpus("barwise/docs/specs/archive/a.spec.md"), false);
  assert.equal(inSpecCorpus("barwise/docs/a.spec.md"), false);
  assert.equal(inSpecCorpus("barwise/docs/specs/a.md"), false);
});

test("a pattern entry stands for the tracked paths it matches, a path for itself", () => {
  const files = ["barwise/a/x.ts", "barwise/b/x.ts", "barwise/b/y.ts"];
  assert.deepEqual(entryPaths("barwise/*/x.ts", files), ["barwise/a/x.ts", "barwise/b/x.ts"]);
  assert.deepEqual(entryPaths("barwise/b/y.ts", files), ["barwise/b/y.ts"]);
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
  // Each option off, with every other option on: it alone removes its kind.
  const all = { dirs: true, anyExtension: true, bare: true, barrels: true };
  const without = (k) => namedPaths(text, exists, { ...all, [k]: false });
  assert.ok(!without("dirs").includes("barwise/packages/cli/"));
  assert.ok(!without("barrels").includes("barwise/packages/core/src/index.ts"));
  assert.ok(!without("anyExtension").includes(".claude/skills/x/SKILL.md"));
  assert.ok(!without("bare").includes("plan.md"));
  assert.equal(namedPaths(text, exists, all).length, 5);
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
    assert.match(r.stderr, /3 Touches: entries do not resolve/);
    assert.match(r.stderr, /a\.spec\.md: barwise\/moved\.ts -- names nothing tracked/);
    assert.match(r.stderr, /a\.spec\.md: barwise\/nodir\/ -- names no tracked directory/);
    assert.match(r.stderr, /a\.spec\.md: barwise\/\*\/none\.ts -- matches nothing tracked/);
  } finally {
    f.done();
  }
});

test("check:spec-touches rejects a pattern outside the review-tiers language, marked or not", () => {
  // The audit expands patterns with the same matcher; a partial-segment
  // wildcard would mean one thing to git and another here.
  const f = gateFixture({ "a.spec.md": spec("barwise/*.mjs, +barwise/new/*.ts") }, [
    "barwise/x.mjs",
  ]);
  try {
    const r = f.run();
    assert.equal(r.status, 1);
    assert.match(r.stderr, /barwise\/\*\.mjs -- .*\*/);
    assert.match(r.stderr, /2 Touches: entries do not resolve/);
  } finally {
    f.done();
  }
});

test("check:spec-touches cannot answer when a spec cannot be read", () => {
  const f = gateFixture({}, ["barwise/x.ts"]);
  try {
    mkdirSync(join(f.dir, "specs", "unreadable.spec.md"));
    const r = f.run();
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /cannot answer/);
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
