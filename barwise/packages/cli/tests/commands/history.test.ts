/**
 * Tests for the history command: a fixture git repo is built in a temp
 * directory with two revisions of a model (plus a rename), and the
 * command's semantic narration is asserted against it.
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

let repoDir: string;

function git(...args: string[]): void {
  execFileSync("git", ["-C", repoDir, ...args], {
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test Author",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  });
}

describe("barwise history", () => {
  beforeEach(() => {
    repoDir = join(
      tmpdir(),
      `barwise-history-${process.pid}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(repoDir, { recursive: true });
    git("init", "--quiet");
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  /**
   * macOS reaches `tmpdir()` through a symlink -- /var/folders/... to
   * /private/var/folders/... -- and `git rev-parse --show-toplevel`
   * reports the real path while `resolve()` does not. Every test here
   * failed on macOS and passed on Linux for that reason alone. The
   * symlink is explicit so the case is exercised on both.
   */
  it("resolves a model reached through a symlinked directory", async () => {
    const modelPath = join(repoDir, "simple.orm.yaml");
    copyFileSync(join(fixtures, "simple.orm.yaml"), modelPath);
    git("add", "simple.orm.yaml");
    git("commit", "--quiet", "-m", "add simple model");

    // A link whose name differs in LENGTH from its target: an equal
    // length makes the old prefix-slice produce the right answer by
    // accident, which is how this hid.
    const link = `${repoDir}-l`;
    symlinkSync(repoDir, link);
    try {
      const result = await runCli(["history", join(link, "simple.orm.yaml")]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("add simple model");
    } finally {
      rmSync(link, { force: true });
    }
  });

  it("narrates revisions with semantic deltas", async () => {
    const modelPath = join(repoDir, "simple.orm.yaml");
    copyFileSync(join(fixtures, "simple.orm.yaml"), modelPath);
    git("add", "simple.orm.yaml");
    git("commit", "--quiet", "-m", "add simple model");

    // Second revision: rename the Name value type.
    const v2 = readFileSync(modelPath, "utf-8").replaceAll('"Name"', '"FullName"');
    writeFileSync(modelPath, v2);
    git("add", "simple.orm.yaml");
    git("commit", "--quiet", "-m", "rename Name to FullName");

    const result = await runCli(["history", modelPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("rename Name to FullName");
    expect(result.stdout).toContain("add simple model");
    expect(result.stdout).toContain("Test Author");
    // The oldest walked revision gets a summary, the newer one deltas.
    expect(result.stdout).toContain("initial:");
    expect(result.stdout).toMatch(/ADDED|REMOVED|MODIFIED/);
  });

  it("includes an uncommitted working-tree entry", async () => {
    const modelPath = join(repoDir, "simple.orm.yaml");
    copyFileSync(join(fixtures, "simple.orm.yaml"), modelPath);
    git("add", "simple.orm.yaml");
    git("commit", "--quiet", "-m", "add simple model");

    writeFileSync(
      modelPath,
      readFileSync(modelPath, "utf-8").replaceAll('"Name"', '"Nickname"'),
    );

    const result = await runCli(["history", modelPath]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("working tree (uncommitted)");
  });

  it("follows a rename", async () => {
    const oldPath = join(repoDir, "old.orm.yaml");
    copyFileSync(join(fixtures, "simple.orm.yaml"), oldPath);
    git("add", "old.orm.yaml");
    git("commit", "--quiet", "-m", "add model");
    git("mv", "old.orm.yaml", "renamed.orm.yaml");
    git("commit", "--quiet", "-m", "rename file");

    const result = await runCli(["history", join(repoDir, "renamed.orm.yaml")]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("add model");
    expect(result.stdout).toContain("rename file");
  });

  it("fails with a clear message outside a git repository", async () => {
    const outside = join(tmpdir(), `barwise-nogit-${process.pid}.orm.yaml`);
    copyFileSync(join(fixtures, "simple.orm.yaml"), outside);
    try {
      const result = await runCli(["history", outside]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("Error:");
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it("honors --limit", async () => {
    const modelPath = join(repoDir, "simple.orm.yaml");
    copyFileSync(join(fixtures, "simple.orm.yaml"), modelPath);
    git("add", "simple.orm.yaml");
    git("commit", "--quiet", "-m", "commit one");
    for (const n of ["two", "three"]) {
      writeFileSync(
        modelPath,
        readFileSync(modelPath, "utf-8").replace(/domain_context: ".*"/, `domain_context: "${n}"`),
      );
      git("add", "simple.orm.yaml");
      git("commit", "--quiet", "-m", `commit ${n}`);
    }

    const result = await runCli(["history", modelPath, "--limit", "2"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("commit three");
    expect(result.stdout).toContain("commit two");
    expect(result.stdout).not.toContain("commit one");
  });
});
