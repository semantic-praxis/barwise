/**
 * Tests for the import command (transcript and batch subcommands).
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { slugifyModel } from "../../src/commands/import.js";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const tmpDir = resolve(__dirname, "../tmp-import-test");

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// slugifyModel
// ---------------------------------------------------------------------------

describe("slugifyModel", () => {
  it("passes through already-slugified names", () => {
    expect(slugifyModel("gpt-5-mini")).toBe("gpt-5-mini");
  });

  it("removes dots", () => {
    expect(slugifyModel("gpt-5.3-codex")).toBe("gpt-53-codex");
  });

  it("lowercases names", () => {
    expect(slugifyModel("Claude-Sonnet-4")).toBe("claude-sonnet-4");
  });

  it("replaces spaces with hyphens", () => {
    expect(slugifyModel("my model name")).toBe("my-model-name");
  });

  it("replaces slashes with hyphens", () => {
    expect(slugifyModel("org/model")).toBe("org-model");
  });

  it("collapses consecutive hyphens", () => {
    expect(slugifyModel("a--b---c")).toBe("a-b-c");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugifyModel("-foo-")).toBe("foo");
  });

  it("handles complex real-world model names", () => {
    expect(slugifyModel("claude-sonnet-4-5-20250929")).toBe(
      "claude-sonnet-4-5-20250929",
    );
    expect(slugifyModel("meta/llama-3.1-70b")).toBe("meta-llama-31-70b");
  });
});

// ---------------------------------------------------------------------------
// barwise import batch -- argument validation
// ---------------------------------------------------------------------------

describe("barwise import batch", () => {
  it("errors when directory does not exist", async () => {
    const result = await runCli([
      "import",
      "batch",
      "/nonexistent/dir",
      "--model",
      "gpt-5-mini",
    ]);
    expect(result.stderr).toContain("Directory not found");
    expect(result.exitCode).toBe(1);
  });

  it("errors when no .md files found", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "readme.txt"), "not a transcript");

    const result = await runCli([
      "import",
      "batch",
      tmpDir,
      "--model",
      "gpt-5-mini",
    ]);
    expect(result.stderr).toContain("No .md transcript files found");
    expect(result.exitCode).toBe(1);
  });

  it("errors when --model is not provided", async () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "test.md"), "Some transcript");

    const result = await runCli(["import", "batch", tmpDir]);
    expect(result.exitCode).toBe(1);
  });

  it("reports empty transcripts as failures", async () => {
    // This test verifies the empty-transcript path without needing
    // an LLM client. The empty transcript is skipped immediately.
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "empty.md"), "   ");

    const result = await runCli([
      "import",
      "batch",
      tmpDir,
      "--model",
      "test-model",
    ]);
    expect(result.stderr).toContain("Skipping empty transcript");
    expect(result.stderr).toContain("Empty transcript");
    expect(result.exitCode).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// barwise import transcript -- basic argument validation
// ---------------------------------------------------------------------------

describe("barwise import transcript", () => {
  it("errors when file does not exist", async () => {
    const result = await runCli([
      "import",
      "transcript",
      "/nonexistent/file.md",
    ]);
    expect(result.exitCode).toBe(1);
  });

  it("errors when file is empty", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const emptyFile = join(tmpDir, "empty.md");
    writeFileSync(emptyFile, "");

    const result = await runCli(["import", "transcript", emptyFile]);
    expect(result.stderr).toContain("Transcript file is empty");
    expect(result.exitCode).toBe(1);
  });
});
