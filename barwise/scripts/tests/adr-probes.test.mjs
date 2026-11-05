/**
 * adr-probes (docs/specs/enforceable-adr-practice.spec.md, WS5), end to
 * end on a git fixture: one ADR declaring a gate that fails on a planted
 * word, and a manifest of probes. Each case is one exit the runner can
 * give and the reason for it.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { readRows } from "../adr-probes.mjs";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "adr-probes.mjs");

const ADR = "# A concern\n\nScope: process\nDate: 2026-11-05\nTracking: barwise-ubc\n"
  + "Enforced-by: npm run check:x (one), npm run check:args -- --strict (two),\n"
  + "none (barwise-gap: three)\n\n"
  + "## Context\n\nWhy.\n\n## Decision\n\n"
  + "1. **One.** {#one} No BAD in src.txt.\n"
  + "2. **Two.** {#two} No WORSE in src.txt, under --strict.\n"
  + "3. **Three.** {#three} Unguarded.\n\n"
  + "## Consequences\n\nWhat follows.\n";

// check:x fails on BAD; check:args fails on WORSE only when given --strict,
// so a probe of decision two catches only if the header's args reach it.
// check:lax is declared nowhere and ignores everything.
const PACKAGE = JSON.stringify({
  name: "fixture",
  private: true,
  scripts: {
    "check:x": "node gate.mjs BAD",
    "check:args": "node gate.mjs WORSE",
  },
});
const GATE = "import { readFileSync } from 'node:fs';\n"
  + "const word = process.argv[2];\n"
  + "if (word === 'WORSE' && !process.argv.includes('--strict')) process.exit(0);\n"
  + "process.exit(readFileSync('src.txt', 'utf8').includes(word) ? 1 : 0);\n";

const ONE = { decision: "a-concern#one", file: "barwise/src.txt", old: "good", new: "BAD" };
const TWO = { decision: "a-concern#two", file: "barwise/src.txt", old: "good", new: "WORSE" };

function fixture(rows, { gate = GATE, src = "all good\n" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "adr-probes-"));
  const w = (p, s) => {
    mkdirSync(dirname(join(dir, p)), { recursive: true });
    writeFileSync(join(dir, p), s);
  };
  w("barwise/docs/adr/a-concern.md", ADR);
  w("barwise/package.json", PACKAGE);
  w("barwise/gate.mjs", gate);
  w("barwise/src.txt", src);
  if (rows !== undefined) {
    w("barwise/docs/adr/probes.json", typeof rows === "string" ? rows : JSON.stringify(rows));
  }
  w(".gitignore", ".mutate-backups/\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe" });
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "fixture");
  return dir;
}

const run = (dir, ...extra) =>
  spawnSync(process.execPath, [SCRIPT, "--root", dir, ...extra], { encoding: "utf8" });

function withFixture(rows, opts, body) {
  const dir = fixture(rows, opts);
  try {
    body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("adr-probes: a probe whose gate goes red exits 0, and lists the unprobed", () => {
  withFixture([ONE, TWO], {}, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /CAUGHT {3}a-concern#one by "npm run check:x \(one\)"/);
    // The header's `-- --strict` reached the gate: without it, check:args
    // ignores WORSE and the probe would read MISSED.
    assert.match(r.stdout, /CAUGHT {3}a-concern#two by "npm run check:args -- --strict \(two\)"/);
    assert.match(r.stdout, /OK$/m);
  });
  withFixture(
    [ONE, { decision: "a-concern#two", unprobed: "reads committed state" }],
    {},
    (dir) => {
      const r = run(dir);
      assert.equal(r.status, 0, r.stdout + r.stderr);
      assert.match(r.stdout, /no probe \(1\)[^]*a-concern#two: reads committed state/);
    },
  );
});

test("adr-probes: a gate that ignores its decision's violation is MISSED, exit 1", () => {
  const blind = "process.exit(0);\n";
  withFixture([ONE], { gate: blind }, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stdout, /MISSED {3}a-concern#one/);
    assert.match(r.stderr, /did not go red[^]*a-concern#one/);
  });
});

test("adr-probes: a moved anchor, a gate red unmutated, a dirty file: exit 2", () => {
  // The anchor is gone: mutate refuses, and the probe is never read as caught.
  withFixture([{ ...ONE, old: "absent" }], {}, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /REFUSED {2}a-concern#one/);
    assert.match(r.stderr, /cannot answer[^]*anchor occurs 0 time/);
  });
  // Red before the edit: there is no reading of the edit.
  withFixture([ONE], { src: "all good, already BAD\n" }, (dir) => {
    const r = run(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stdout, /REFUSED {2}a-concern#one/);
  });
  // Uncommitted work in the probed file is not the committed tree.
  withFixture([ONE], {}, (dir) => {
    writeFileSync(join(dir, "barwise", "src.txt"), "all good, edited\n");
    const r = run(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /barwise\/src\.txt has uncommitted changes/);
  });
});

test("adr-probes: a row naming no declared gate is a finding before anything runs", () => {
  for (
    const [decision, message] of [
      ["a-concern#four", /a-concern#four: no ADR has this decision/],
      ["a-concern#three", /a-concern#three: no npm entry of its ADR lists it/],
    ]
  ) {
    // The gate would refuse (red unmutated) if it ran, so exit 1 shows the
    // rows were judged first.
    withFixture([ONE, { ...ONE, decision }], { src: "BAD\n" }, (dir) => {
      const r = run(dir);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, message);
      assert.doesNotMatch(r.stdout, /REFUSED|CAUGHT/);
    });
  }
});

test("adr-probes: a manifest absent, unreadable, malformed or empty refuses, exit 2", () => {
  for (
    const [rows, message] of [
      [undefined, /probes\.json would not read/],
      ["{", /is not JSON/],
      [JSON.stringify({ probes: [] }), /is not an array/],
      [[{ decision: "a-concern#one", file: "x" }], /row 1 is neither/],
      [[], /no probe to run/],
      [[{ decision: "a-concern#one", unprobed: "why" }], /no probe to run/],
    ]
  ) {
    withFixture(rows, {}, (dir) => {
      const r = run(dir);
      assert.equal(r.status, 2, `${message}\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, message);
    });
  }
});

test("adr-probes: readRows accepts the two row shapes and nothing between them", () => {
  assert.deepEqual(readRows(JSON.stringify([ONE])).rows, [ONE]);
  assert.ok(readRows(JSON.stringify([{ ...ONE, unprobed: "both" }])).problem);
  assert.ok(readRows(JSON.stringify([{ ...ONE, old: "" }])).problem);
  assert.ok(readRows(JSON.stringify([null])).problem);
});
