/**
 * check:findings over a copy of the real baselines, catalog and tracker,
 * with one planted violation per case (docs/specs/audit-finding-reader.spec.md,
 * WS1). Each finding kind is exit 1 and names its row; each unreadable or
 * unmappable input is exit 2, never a clean pass.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const GATE = join(REPO, "barwise", "scripts", "check-findings.mjs");
const BASELINES = [
  "audit-baseline.json",
  "rubric-baseline.json",
  "spec-status-baseline.json",
  "correction-baseline.json",
  "trial-baseline.json",
];
const CATALOG = "barwise/trial/findings/catalog.json";
const TRACKER = ".beads/issues.jsonl";

/** A tree holding only what the gate reads, copied from this checkout. */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-findings-"));
  for (const rel of [...BASELINES.map((b) => `barwise/${b}`), CATALOG, TRACKER]) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    cpSync(join(REPO, rel), join(dir, rel));
  }
  return dir;
}

const run = (dir) => spawnSync(process.execPath, [GATE, "--root", dir], { encoding: "utf8" });

/** Edit one JSON file of the fixture, run the gate, and clean up. */
function planted(rel, edit) {
  const dir = fixture();
  try {
    const path = join(dir, rel);
    const json = JSON.parse(readFileSync(path, "utf8"));
    edit(json);
    writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
    return run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The first row of a baseline's row object, and its id. */
const first = (rows) => {
  const id = Object.keys(rows)[0];
  return [id, rows[id]];
};

/** An issue id in the tracker with the given status. */
function issueWith(status) {
  for (const line of readFileSync(join(REPO, TRACKER), "utf8").split("\n")) {
    if (!line) continue;
    const o = JSON.parse(line);
    if (o.status === status) return o.id;
  }
  throw new Error(`no ${status} issue in the tracker`);
}

const found = (r, pattern) => {
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stderr, pattern);
};

test("check:findings passes the real baselines", () => {
  const r = spawnSync(process.execPath, [GATE], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /5 baselines .* OK$/m);
});

test("check:findings fails an open row whose issue is closed or missing", () => {
  const closed = issueWith("closed");
  found(
    planted("barwise/audit-baseline.json", (j) => {
      first(j.candidates)[1].status = `tracked:${closed}`;
    }),
    new RegExp(`audit-baseline\\.json: .*names ${closed.replace(/\./g, "\\.")}, which is closed`),
  );
  found(
    planted("barwise/trial-baseline.json", (j) => {
      first(j.findings)[1].issue = "barwise-nosuch";
    }),
    /trial-baseline\.json: .*names barwise-nosuch, which is not in the tracker/,
  );
  found(
    planted("barwise/rubric-baseline.json", (j) => {
      first(j.checks)[1].verdict = `tracked:${closed} still open?`;
    }),
    /rubric-baseline\.json: .*which is closed/,
  );
});

test("check:findings keeps a claimed (in_progress) issue live", () => {
  const claimed = issueWith("in_progress");
  const r = planted("barwise/audit-baseline.json", (j) => {
    first(j.candidates)[1].status = `tracked:${claimed}`;
  });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("check:findings fails a row that still has its writer's placeholder, in every source", () => {
  const cases = [
    ["barwise/audit-baseline.json", (j) => delete first(j.candidates)[1].status],
    ["barwise/rubric-baseline.json", (j) => (first(j.checks)[1].verdict = "TODO")],
    ["barwise/spec-status-baseline.json", (j) => (first(j.specs)[1].note = "TODO: classify")],
    ["barwise/correction-baseline.json", (j) => (first(j.records)[1].caught_by = "TODO: classify")],
    ["barwise/trial-baseline.json", (j) => (first(j.findings)[1].issue = null)],
  ];
  for (const [rel, edit] of cases) {
    found(
      planted(rel, edit),
      new RegExp(`${rel.split("/").pop().replace(/\./g, "\\.")}: .*placeholder`),
    );
  }
});

test("check:findings fails a verdict outside its audit's vocabulary", () => {
  found(
    planted("barwise/audit-baseline.json", (j) => (first(j.candidates)[1].status = "bogus")),
    /audit-baseline\.json: .*"bogus" is not one of accepted-benign, tracked/,
  );
  found(
    planted("barwise/rubric-baseline.json", (j) => (first(j.checks)[1].verdict = "fine: it works")),
    /rubric-baseline\.json: .*"fine" is not one of/,
  );
  found(
    planted("barwise/correction-baseline.json", (j) => (first(j.records)[1].caught_by = "luck")),
    /correction-baseline\.json: .*"luck" is not one of execution, not-a-correction/,
  );
  found(
    planted("barwise/trial-baseline.json", (j) => (first(j.findings)[1].class = "no-such-class")),
    /trial-baseline\.json: .*"no-such-class" is not one of/,
  );
});

test("check:findings fails a trial catalog class whose issue is closed", () => {
  const closed = issueWith("closed");
  found(
    planted(CATALOG, (j) => (j.classes[0].issue = closed)),
    /catalog\.json: class .* is closed/,
  );
});

test("check:findings cannot answer when an input is absent, malformed or unmappable", () => {
  const refused = (r, pattern) => {
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, pattern);
  };
  for (const rel of [`barwise/${BASELINES[2]}`, CATALOG, TRACKER]) {
    const dir = fixture();
    try {
      rmSync(join(dir, rel));
      refused(run(dir), /cannot answer/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  const dir = fixture();
  try {
    writeFileSync(join(dir, "barwise", BASELINES[0]), "{ not json");
    refused(run(dir), /cannot answer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  refused(
    planted("barwise/correction-baseline.json", (j) => (first(j.records)[1].caught_by = 7)),
    /cannot answer -- corrections: row .* has no caught_by string/,
  );
  refused(
    planted("barwise/rubric-baseline.json", (j) => (j.checks = [])),
    /cannot answer -- rubric-baseline\.json: no "checks" object/,
  );
});
