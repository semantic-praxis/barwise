/**
 * Build provenance resolution
 * (eval-run-resolution-and-provenance spec, workstream 3).
 *
 * The failure mode that matters most is the graceful one: an eval run
 * costs money, and nothing about recording where it came from may be
 * able to lose it. Every path below that cannot find a repository has
 * to return the version and move on.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeProvenance, resolveProvenance } from "../../src/workspace/provenance.js";

const here = dirname(fileURLToPath(import.meta.url));

describe("resolveProvenance", () => {
  it("reports the commit and tree state from inside the barwise checkout", () => {
    const build = resolveProvenance("1.7.0", here);
    expect(build.version).toBe("1.7.0");
    expect(build.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof build.dirty).toBe("boolean");
  });

  it("returns the version alone outside any repository", () => {
    // The path that must never throw. A temp directory has no git root
    // above it, so there is nothing to record but the version.
    const dir = mkdtempSync(join(tmpdir(), "barwise-prov-"));
    expect(resolveProvenance("1.7.0", dir)).toEqual({ version: "1.7.0" });
  });

  it("refuses a repository that is not barwise", () => {
    // A globally installed CLI can sit in some other project's
    // node_modules. Recording that project's commit as barwise's would
    // be confidently wrong, which is worse than recording nothing.
    const dir = mkdtempSync(join(tmpdir(), "barwise-prov-"));
    try {
      execGit(dir, ["init", "-q"]);
      writeFileSync(join(dir, "README.md"), "not barwise\n");
      execGit(dir, ["add", "-A"]);
      execGit(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
    } catch {
      return; // No usable git in this environment; the point is moot.
    }
    expect(resolveProvenance("1.7.0", dir)).toEqual({ version: "1.7.0" });
  });

  it("refuses a repository whose barwise marker names something else", () => {
    // The marker is checked by name, not merely by path, so a directory
    // that happens to be called barwise/ does not qualify.
    const dir = mkdtempSync(join(tmpdir(), "barwise-prov-"));
    try {
      execGit(dir, ["init", "-q"]);
      mkdirSync(join(dir, "barwise"));
      writeFileSync(join(dir, "barwise", "package.json"), JSON.stringify({ name: "impostor" }));
      execGit(dir, ["add", "-A"]);
      execGit(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
    } catch {
      return;
    }
    expect(resolveProvenance("1.7.0", dir)).toEqual({ version: "1.7.0" });
  });

  it("does not call an untracked file a modification", () => {
    // `git status --porcelain` lists untracked files as `??` entries, so
    // the bare form marked every run dirty over a scratch note. Worse,
    // `history.jsonl` is untracked itself: the first recorded run wrote
    // the file that made every later run report an unreproducible
    // commit. Dirty must mean the tracked source moved.
    const dir = mkdtempSync(join(tmpdir(), "barwise-prov-"));
    try {
      execGit(dir, ["init", "-q"]);
      mkdirSync(join(dir, "barwise"));
      writeFileSync(join(dir, "barwise", "package.json"), JSON.stringify({ name: "barwise" }));
      execGit(dir, ["add", "-A"]);
      execGit(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
    } catch {
      return; // No usable git here; the point is moot.
    }

    expect(resolveProvenance("1.7.0", dir).dirty).toBe(false);

    // The exact shape that was misreporting: an unversioned history file
    // sitting beside the suite it records.
    writeFileSync(join(dir, "history.jsonl"), "{}\n");
    expect(resolveProvenance("1.7.0", dir).dirty).toBe(false);

    // A tracked file that actually changed still counts, which is the
    // half of the behaviour worth keeping.
    writeFileSync(join(dir, "barwise", "package.json"), JSON.stringify({ name: "barwise", x: 1 }));
    expect(resolveProvenance("1.7.0", dir).dirty).toBe(true);
  });

  it("survives a directory that does not exist", () => {
    expect(resolveProvenance("1.7.0", join(tmpdir(), "barwise-does-not-exist-9137")))
      .toEqual({ version: "1.7.0" });
  });

  it("returns the version alone when process.argv[1] is empty and no fromDir is given", () => {
    const original = process.argv[1];
    process.argv[1] = "";
    try {
      expect(resolveProvenance("1.7.0")).toEqual({ version: "1.7.0" });
    } finally {
      process.argv[1] = original;
    }
  });

  it("returns the version alone for a barwise repo with no commits yet", () => {
    // The marker check is a raw filesystem read, not a git-tracked
    // one, so an uncommitted marker still resolves the root -- and
    // `rev-parse HEAD` then fails on the unborn branch.
    const dir = mkdtempSync(join(tmpdir(), "barwise-prov-"));
    try {
      execGit(dir, ["init", "-q"]);
      mkdirSync(join(dir, "barwise"));
      writeFileSync(join(dir, "barwise", "package.json"), JSON.stringify({ name: "barwise" }));
    } catch {
      return;
    }
    expect(resolveProvenance("1.7.0", dir)).toEqual({ version: "1.7.0" });
  });
});

describe("describeProvenance", () => {
  it("is the bare version when no commit is known", () => {
    expect(describeProvenance({ version: "1.7.0" })).toBe("1.7.0");
  });

  it("abbreviates the commit", () => {
    expect(describeProvenance({ version: "1.7.0", commit: "deadbeefcafe", dirty: false }))
      .toBe("1.7.0 (deadbee)");
  });

  it("marks a modified tree, because the commit alone would be a lie", () => {
    expect(describeProvenance({ version: "1.7.0", commit: "deadbeefcafe", dirty: true }))
      .toBe("1.7.0 (deadbee-dirty)");
  });
});

function execGit(cwd: string, args: string[]): void {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}
