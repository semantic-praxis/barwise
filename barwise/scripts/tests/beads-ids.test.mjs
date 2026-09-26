/**
 * beads-crud mints random ids, never max+1 (beads-random-ids.spec.md,
 * barwise-w1u): the counter read a tracker that is stale on every branch
 * behind main, and two branches minted one id five times.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { MAX_TRIES, mintId } from "../lib/beads-ids.mjs";

const CRUD = join(dirname(fileURLToPath(import.meta.url)), "..", "beads-crud.mjs");

test("mintId skips all-digit and taken suffixes, and gives up after MAX_TRIES", () => {
  const draws = ["123", "abc", "x9z"];
  const draw = () => draws.shift();
  // "123" could collide with a sequential id; "abc" is taken.
  assert.equal(mintId("barwise", "-", new Set(["barwise-abc"]), draw), "barwise-x9z");
  let calls = 0;
  const always = () => (calls++, "abc");
  assert.equal(mintId("barwise", "-", new Set(["barwise-abc"]), always), null);
  assert.equal(calls, MAX_TRIES);
});

/** A throwaway git repo with one numeric issue, and a create runner over it. */
function tracker() {
  const dir = mkdtempSync(join(tmpdir(), "beads-ids-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  mkdirSync(join(dir, ".beads"));
  const seed = {
    _type: "issue",
    id: "barwise-7",
    title: "seed",
    status: "open",
    priority: 2,
    issue_type: "task",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  };
  writeFileSync(join(dir, ".beads", "issues.jsonl"), JSON.stringify(seed) + "\n");
  const create = (...args) => {
    const r = spawnSync(process.execPath, [CRUD, "create", "--title", "t", ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  const ids = () =>
    readFileSync(join(dir, ".beads", "issues.jsonl"), "utf8").trim().split("\n").map((l) =>
      JSON.parse(l).id
    );
  return { dir, create, ids };
}

test("create mints distinct random ids and never max+1", () => {
  const t = tracker();
  try {
    const made = Array.from({ length: 50 }, () => t.create());
    assert.equal(new Set(made).size, 50);
    for (const id of made) {
      assert.match(id, /^barwise-[0-9a-z]{3}$/);
      assert.doesNotMatch(id, /^barwise-[0-9]+$/, `${id} could equal a sequential id`);
    }
    assert.ok(!made.includes("barwise-8"));
    assert.deepEqual(t.ids().slice(1), made);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});

test("a child gets <parent>.<random>, not <parent>.<n+1>", () => {
  const t = tracker();
  try {
    const child = t.create("--parent", "barwise-7");
    assert.match(child, /^barwise-7\.[0-9a-z]{3}$/);
    assert.doesNotMatch(child, /^barwise-7\.[0-9]+$/);
  } finally {
    rmSync(t.dir, { recursive: true, force: true });
  }
});
